/**
 * Image upload module for veo-cli
 * Handles uploading images via Flow web UI using puppeteer
 * Includes caching layer to avoid re-uploading identical images
 */

import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import sizeOf from "image-size";
import type { PageWithCursor } from "puppeteer-real-browser";
import type { Protocol } from "devtools-protocol";
import type { Cookie } from "rebrowser-puppeteer-core";
import type { Project } from "./types";
import { log, debug } from "./config";
import { createProject, fetchUserMediaHistory } from "./api";
import { getImageCache, setImageCache, hashFileContents } from "./db-unified";

type ImageOrientation = "landscape" | "portrait";

interface OrientationResult {
  orientation: ImageOrientation;
  width?: number;
  height?: number;
}

/**
 * Detect image orientation based on dimensions
 * Returns "portrait" if height > width, "landscape" otherwise
 */
function detectImageOrientation(imagePath: string): OrientationResult {
  try {
    const dimensions = sizeOf(imagePath);
    if (dimensions.width && dimensions.height) {
      const orientation: ImageOrientation = dimensions.height > dimensions.width ? "portrait" : "landscape";
      return { orientation, width: dimensions.width, height: dimensions.height };
    }
  } catch (e) {
    debug(`    Failed to detect image dimensions: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { orientation: "landscape" };
}

/**
 * Click an element using realistic mouse movement and click
 * Falls back to direct click if bounding box is unavailable
 */
async function clickWithMouse(
  page: PageWithCursor,
  element: Awaited<ReturnType<typeof page.$>>,
  logPrefix = ""
): Promise<boolean> {
  if (!element) return false;

  const box = await element.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (logPrefix) {
      log(`${logPrefix}Moving mouse to (${Math.round(x)}, ${Math.round(y)})`);
    }
    await page.mouse.move(x, y, { steps: 10 });
    await Bun.sleep(100);
    await page.mouse.down();
    await Bun.sleep(50);
    await page.mouse.up();
    return true;
  }

  await element.click();
  return true;
}

/**
 * Find and click a menu option by text within the page
 * Searches common menu element selectors for an exact text match
 */
async function findAndClickMenuOption(
  page: PageWithCursor,
  targetText: string
): Promise<{ clicked: boolean; x?: number; y?: number }> {
  return page.evaluate((target) => {
    const selectors = 'span, div, li, [role="option"], [role="menuitem"]';
    for (const el of document.querySelectorAll(selectors)) {
      const text = (el.textContent || "").trim();
      const rect = el.getBoundingClientRect();
      const isMenuSized = rect.width > 20 && rect.height > 10 && rect.height < 60 && rect.width < 200;
      if (isMenuSized && text.toLowerCase() === target.toLowerCase()) {
        (el as HTMLElement).click();
        return { clicked: true, x: rect.x, y: rect.y };
      }
    }
    return { clicked: false };
  }, targetText);
}

/**
 * Find the aspect ratio dropdown button in the crop dialog
 * Returns the button element if found, null otherwise
 */
async function findAspectDropdown(
  page: PageWithCursor
): Promise<Awaited<ReturnType<typeof page.$>> | null> {
  const allButtons = await page.$$("button");
  for (const btn of allButtons) {
    const text = await btn.evaluate((el) => el.textContent || "").catch(() => "");
    const lowerText = text.toLowerCase();
    const hasOrientation = lowerText.includes("landscape") || lowerText.includes("portrait");
    const isNotCropButton = !lowerText.includes("crop and save");
    if (hasOrientation && isNotCropButton) {
      return btn;
    }
  }
  return null;
}

/**
 * Check if the current dropdown selection needs to change based on detected orientation
 */
function needsOrientationChange(
  currentText: string,
  targetOrientation: ImageOrientation
): boolean {
  const lowerText = currentText.toLowerCase();
  if (targetOrientation === "portrait") {
    return !lowerText.includes("portrait");
  }
  return !lowerText.includes("landscape");
}

/**
 * Select the correct aspect ratio in the crop dialog based on image orientation
 * Opens the dropdown and clicks the appropriate option (Portrait or Landscape)
 */
async function selectCropAspectRatio(
  page: PageWithCursor,
  detectedOrientation: ImageOrientation
): Promise<void> {
  const aspectDropdown = await findAspectDropdown(page);
  if (!aspectDropdown) {
    log(`    No aspect dropdown found, proceeding with default`);
    return;
  }

  const dropdownText = await aspectDropdown.evaluate((el) => el.textContent || "");
  if (!needsOrientationChange(dropdownText, detectedOrientation)) {
    return;
  }

  log(`    Switching crop from ${dropdownText.trim()} to ${detectedOrientation}`);
  const targetText = detectedOrientation === "portrait" ? "Portrait" : "Landscape";

  // Try clicking dropdown and selecting option (with one retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    await clickWithMouse(page, aspectDropdown, attempt === 0 ? "    " : "");
    if (attempt === 0) {
      log(`    Mouse clicked dropdown`);
    }
    await Bun.sleep(500);

    const result = await findAndClickMenuOption(page, targetText);
    if (result.clicked) {
      log(`    Clicked ${targetText} option at (${result.x}, ${result.y})`);
      await Bun.sleep(500);
      return;
    }

    if (attempt === 0) {
      log(`    First attempt didn't find option, retrying...`);
    }
  }

  log(`    Could not find ${targetText} option to click`);
}

/**
 * Capture a debug screenshot when an error occurs
 * Returns the path to the screenshot or null if capture failed
 */
async function captureDebugScreenshot(
  page: PageWithCursor,
  context: string
): Promise<string | null> {
  try {
    const timestamp = Date.now();
    const filename = `debug-${context}-${timestamp}.png`;
    const outputDir = join(process.cwd(), "output-videos");

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const filepath = join(outputDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    debug(`    Debug screenshot saved: ${filename}`);
    return filepath;
  } catch (e) {
    debug(`    Failed to capture screenshot: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// Regex to match media IDs in responses
// We use a broad pattern to catch CAM... or potentially other forms if they exist
const MEDIA_ID_PATTERN = /CAM[a-zA-Z0-9_-]{30,}/g;

/**
 * Extract all media IDs from text content
 */
function extractMediaIds(text: string): string[] {
  const matches = text.match(MEDIA_ID_PATTERN);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract the last media ID from text content
 */
function extractMediaId(text: string): string | null {
  const matches = extractMediaIds(text);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Find an element by text content with polling
 */
async function findElementByText(
  page: PageWithCursor,
  selector: string,
  text: string,
  timeout = 5000
): Promise<any> {
  const startTime = Date.now();
  const lowerText = text.toLowerCase();

  while (Date.now() - startTime < timeout) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        try {
          const elText = await el.evaluate((e) => e.textContent || "");
          if (elText.toLowerCase().includes(lowerText)) {
            return el;
          }
        } catch {
          // Element detached during evaluation, skip to next
          continue;
        }
      }
    } catch {
      // Page or frame detached, continue polling
    }
    await Bun.sleep(200);
  }
  return null;
}

type ButtonCandidate = { btn: any; text: string; priority: number };

/**
 * Helper to get information about the current UI state (dialogs, file inputs, etc.)
 */
async function getUIState(page: PageWithCursor) {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog, [role="dialog"], [aria-modal="true"]');
    const overlay = document.querySelector('[class*="overlay"], [class*="modal"], [class*="picker"]');
    const fileInput = document.querySelector('input[type="file"]');
    return {
      hasDialog: dialog !== null,
      hasOverlay: overlay !== null,
      hasFileInput: fileInput !== null,
      dialogText: dialog?.textContent?.substring(0, 100) || null
    };
  }).catch(() => ({ hasDialog: false, hasOverlay: false, hasFileInput: false, dialogText: null }));
}

/**
 * Find the "add" button to open image picker
 * Prioritizes: exact "add" text > aria-label > small square buttons
 */
async function findAddButton(page: PageWithCursor): Promise<any> {
  try {
    const allButtons = await page.$$("button");
    const candidates: ButtonCandidate[] = [];

    for (const btn of allButtons) {
      try {
        const info = await btn.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: (el.textContent || "").trim().toLowerCase(),
            ariaLabel: (el.getAttribute("aria-label") || "").toLowerCase(),
            visible: el.offsetParent !== null && rect.width > 0 && rect.height > 0,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
          };
        });

        if (!info.visible) continue;

        const lowerText = info.text.toLowerCase();
        const lowerLabel = info.ariaLabel.toLowerCase();

        // Exclude buttons that clearly indicate a filled slot (have a close/X button)
        if (lowerText.includes("close") || lowerLabel.includes("close") || lowerText.includes("change")) {
          continue;
        }

        // Priority 1: Mode-specific labels ("First Frame", "End Frame")
        if (lowerLabel.includes("first frame") || lowerLabel.includes("end frame") || lowerText.includes("first frame") || lowerText.includes("end frame")) {
          candidates.push({ btn, text: lowerLabel || lowerText, priority: 0 });
        }
        // Priority 2: exact "add" text/icon or aria-label containing "add"
        else if ((info.text === "add" || info.ariaLabel.includes("add")) && info.width < 100 && info.height < 100) {
          // Prefer buttons in lower part of page (frame input area)
          const priority = info.top > 300 ? 1 : 2;
          candidates.push({ btn, text: `${info.text || info.ariaLabel}@${Math.round(info.top)}`, priority });
        }
        // Priority 3: "+" symbol text
        else if (info.text === "+" && info.width < 100) {
          candidates.push({ btn, text: info.text, priority: 3 });
        }
        // Priority 4: small square buttons (likely icon buttons)
        else if (info.width > 30 && info.width < 100 && info.height > 30 && info.height < 100) {
          const excludedText = ["edit", "swap", "arrow", "close", "help"];
          if (!excludedText.some((t) => info.text.includes(t) || info.ariaLabel.includes(t))) {
            candidates.push({ btn, text: info.text || info.ariaLabel || "icon-button", priority: 4 });
          }
        }
      } catch {
        // Button detached, skip to next
        continue;
      }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    if (candidates.length > 0) {
      debug(`    Found ${candidates.length} add button candidates, choosing top priority: ${candidates[0].text}`);
    }
    return candidates[0]?.btn ?? null;
  } catch {
    return null;
  }
}

/**
 * Find and click the upload button in the dialog
 */
async function clickUploadButton(
  page: PageWithCursor,
  findButtonByText: (text: string, timeout?: number) => Promise<any>
): Promise<void> {
  // Wait for dialog to appear first
  try {
    await page.waitForSelector('dialog, [role="dialog"], [aria-modal="true"]', { timeout: 8000 });
    log(`    Dialog appeared`);
    await Bun.sleep(1000); // Let dialog content render fully
  } catch {
    log(`    No dialog selector found, checking for overlay...`);
    // Dialog might use different structure, try to find upload elements anyway
    await Bun.sleep(1000);
  }

  // Strategy 1: Find button with "Upload" text
  let uploadBtn = await findButtonByText("Upload", 3000);
  if (uploadBtn) log(`    Found Upload button via strategy 1`);

  // Strategy 2: Check tabs
  if (!uploadBtn) {
    uploadBtn = await findElementByText(page, '[role="tab"]', "upload", 2000);
    if (uploadBtn) log(`    Found Upload tab via strategy 2`);
  }

  // Strategy 3: Check inside dialog specifically
  if (!uploadBtn) {
    uploadBtn = await findElementByText(
      page,
      'dialog button, dialog [role="tab"], [role="dialog"] button',
      "upload",
      2000
    );
    if (uploadBtn) log(`    Found Upload button via strategy 3`);
  }

  // Strategy 4: Any clickable element with "upload" text
  if (!uploadBtn) {
    uploadBtn = await findElementByText(
      page,
      'button, [role="tab"], [role="button"], a',
      "upload",
      2000
    );
    if (uploadBtn) log(`    Found Upload element via strategy 4`);
  }

  // Strategy 5: Try clicking directly in case it's a file input trigger
  if (!uploadBtn) {
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        log(`    Found file input directly, clicking it`);
        await fileInput.click();
        return;
      }
    } catch {
      // Continue
    }
  }

  // Strategy 6: Look for file input and trigger via JavaScript
  if (!uploadBtn) {
    try {
      const hasFileInput = await page.evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        if (input) {
          (input as HTMLInputElement).click();
          return true;
        }
        return false;
      });
      if (hasFileInput) {
        log(`    Triggered file input via JavaScript`);
        return;
      }
    } catch {
      // Continue
    }
  }

  if (uploadBtn) {
    // Try multiple click strategies for the upload button
    try {
      await uploadBtn.click();
      log(`    Clicked Upload button via native click`);
    } catch {
      try {
        const box = await uploadBtn.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          log(`    Clicked Upload button via mouse`);
        }
      } catch {
        await page.evaluate((el) => (el as HTMLElement).click(), uploadBtn);
        log(`    Clicked Upload button via JavaScript`);
      }
    }
    await Bun.sleep(1000); // Wait for potential file chooser to appear
  } else {
    // List buttons found for debugging
    try {
      const buttons = await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [role="tab"], [role="button"]');
        return Array.from(btns).slice(0, 15).map(b => (b.textContent || '').trim().substring(0, 30));
      });
      debug(`    Buttons found: ${buttons.join(', ')}`);
    } catch {
      // Ignore debug errors
    }
    // Capture screenshot for debugging
    await captureDebugScreenshot(page, "upload-button-not-found");
    throw new Error("Upload button not found. Try running with --visible to debug the browser interaction.");
  }
}

/**
 * Helper to add timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    )
  ]);
}

/**
 * Upload file using direct file input element
 * Returns true if file was selected, false if no file input found
 * Note: Caller is responsible for capturing mediaId from network responses
 */
async function uploadViaFileInput(
  page: PageWithCursor,
  imagePath: string,
  timeout = 15000
): Promise<boolean> {
  // Find file input handle
  const fileInput = await page.$('input[type="file"]');

  if (!fileInput) {
    debug("    No file input found");
    return false;
  }

  log("    Using direct file input (uploadFile)");

  try {
    // Puppeteer's direct way to set files
    await fileInput.uploadFile(imagePath);

    // Manually trigger change event
    await page.evaluate((el) => {
      (el as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
    }, fileInput);

    log("    File selected via uploadFile");
    return true;
  } catch (e) {
    debug(`    uploadFile failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Click the visible Upload box/area in the image picker
 * Google's UI shows an "Upload" box with cloud icon that needs to be clicked
 * This is more reliable than clicking the hidden file input
 */
async function clickVisibleUploadBox(page: PageWithCursor): Promise<boolean> {
  try {
    // Strategy 1: Find the SMALLEST element containing "Upload" and format text
    const uploadBox = await page.evaluateHandle(() => {
      const elements = document.querySelectorAll('div, span, p, label');
      let bestMatch: Element | null = null;
      let bestSize = Infinity;

      for (const el of elements) {
        // Only look for elements that don't have children which also have "Upload"
        // This helps find the actual label or button rather than the container
        const text = el.textContent || '';
        const hasUpload = text.includes('Upload');
        const hasFormats = text.includes('png') || text.includes('jpg') || text.includes('webp') || text.includes('heic');

        if (hasUpload && hasFormats) {
          const rect = el.getBoundingClientRect();
          // Relaxing visibility check: must have dimensions and be somewhat visible
          const isVisible = rect.width > 20 && rect.height > 20;

          if (isVisible) {
            const size = rect.width * rect.height;
            if (size < bestSize && rect.width < 500 && rect.height < 500) {
              bestSize = size;
              bestMatch = el;
            }
          }
        }
      }
      return bestMatch;
    });

    if (uploadBox) {
      const element = uploadBox.asElement();
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          // Double check if coordinates are sane
          if (box.x >= 0 && box.y >= 0) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            log(`    Clicked visible Upload box at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
            return true;
          } else {
            debug(`    Upload box found but coordinates are invalid: (${box.x}, ${box.y})`);
          }
        }
      }
    }

    // Strategy 2: Look for element with upload icon/class or specific aria-label
    const uploadIcon = await page.$('[class*="upload"], [aria-label*="Upload"], [data-testid*="upload"], .upload-icon');
    if (uploadIcon) {
      const box = await uploadIcon.boundingBox();
      if (box && box.x >= 0 && box.y >= 0) {
        await uploadIcon.click();
        log(`    Clicked upload icon element at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
        return true;
      }
    }

    // Strategy 3: Look for text "Upload" specifically
    const uploadText = await page.evaluateHandle(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let candidate: Element | null = null;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent?.trim() === 'Upload') {
          let parent = node.parentElement;
          // Step up to find a reasonably sized clickable parent
          while (parent && parent.getBoundingClientRect().width < 10) {
            parent = parent.parentElement;
          }
          if (parent) {
            const rect = parent.getBoundingClientRect();
            if (rect.top >= 0 && rect.left >= 0 && rect.width > 0) {
              candidate = parent;
              break;
            }
          }
        }
      }
      return candidate;
    });

    if (uploadText) {
      const element = uploadText.asElement();
      if (element) {
        const box = await element.boundingBox();
        if (box && box.x >= 0 && box.y >= 0) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          log(`    Clicked Upload text element at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
          return true;
        }
      }
    }

    log(`    No visible Upload box found`);
    return false;
  } catch (e) {
    debug(`    Failed to click upload box: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Handle the "Notice" / "I agree" dialog that appears when uploading images
 * This dialog requires user acknowledgment before the file chooser appears
 */
async function handleNoticeDialog(page: PageWithCursor): Promise<boolean> {
  try {
    // Look for the "I agree" button in a dialog
    const iAgreeBtn = await page.evaluateHandle(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim();
        if (text === 'I agree' || text === 'I Agree') {
          return btn;
        }
      }
      return null;
    });

    if (iAgreeBtn) {
      const element = iAgreeBtn.asElement();
      if (element) {
        const box = await element.boundingBox();
        if (box && box.x >= 0 && box.y >= 0) {
          await (element as any).click();
          log(`    Clicked "I agree" button in Notice dialog`);
          await Bun.sleep(500);
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    debug(`    Failed to handle Notice dialog: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Upload image via Flow web UI using puppeteer
 * This navigates to Flow, uploads the image, crops it, and extracts the mediaGenerationId
 * Creates a fresh project for each upload to ensure clean UI state
 * @param uploadMode - "frames" for I2V/Frames mode, "ingredients" for R2V/Ingredients mode
 */
export async function uploadImageViaFlow(
  page: PageWithCursor,
  imagePath: string,
  cookies: Cookie[],
  aspectRatio: "landscape" | "portrait",
  existingProject?: Project,
  uploadMode: "frames" | "ingredients" = "frames"
): Promise<string> {
  log(`  Uploading image via Flow UI...`);

  let project = existingProject;

  if (!project) {
    // Create a fresh project for this upload to ensure clean UI state
    const timestamp = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const projectTitle = `[Upload ${timestamp}]`;
    log(`    Creating fresh project: ${projectTitle}`);

    const result = await createProject(cookies, projectTitle, "PINHOLE");
    project = result.project;
  }

  log(`    Using project for upload: ${project.projectId.substring(0, 8)}...`);

  // Overall timeout for the entire upload operation (90 seconds)
  const uploadPromise = uploadImageViaFlowImpl(page, imagePath, project, aspectRatio, cookies, uploadMode);
  return withTimeout(uploadPromise, 90000, "Upload timed out after 90 seconds");
}

/**
 * Internal implementation of image upload
 * @param uploadMode - "frames" for I2V/Frames mode, "ingredients" for R2V/Ingredients mode
 */
async function uploadImageViaFlowImpl(
  page: PageWithCursor,
  imagePath: string,
  project: Project,
  aspectRatio: "landscape" | "portrait",
  cookies: Cookie[],
  uploadMode: "frames" | "ingredients" = "frames"
): Promise<string> {
  // ALWAYS navigate to project page to ensure clean state
  // Skipping navigation based on URL can leave page in stale state (dialogs, loading, etc.)
  const projectUrl = `https://labs.google/fx/tools/flow/project/${project.projectId}`;
  const currentUrl = page.url();

  if (currentUrl === projectUrl || currentUrl.includes(project.projectId)) {
    log(`    Reloading project page for clean state: ${project.projectId.substring(0, 8)}...`);
  } else {
    log(`    Navigating to project: ${projectUrl}`);
  }
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });

  // Start tracking time for network interception
  let uploadStartTime: number = Date.now();

  // Enable CDP Network domain to capture ALL network traffic (including Fetch API)
  // This is more reliable than puppeteer's response handler for some request types
  const cdpClient = await page.createCDPSession();
  await cdpClient.send('Network.enable', { maxResourceBufferSize: 10 * 1024 * 1024 });

  let cdpCapturedMediaId: string | null = null;
  const cdpResponseBodies: Map<string, string> = new Map();

  // Listen for all network responses via CDP
  cdpClient.on('Network.responseReceived', async (params: Protocol.Network.ResponseReceivedEvent) => {
    try {
      const url = params.response?.url || '';
      const method = params.response?.requestHeaders?.['method'] || 'GET';

      // Log interesting upload-related requests
      const isUploadRelated = url.includes('upload') || url.includes('media') ||
                              url.includes('googleapis') || url.includes('storage.google') ||
                              url.includes('aisandbox') || url.includes('trpc') ||
                              url.includes('asset') || url.includes('blob');

      // Filter out noise
      const isNoise = url.includes('.js') || url.includes('.css') || url.includes('.woff') ||
                      url.includes('analytics') || url.includes('reportClientSideError') ||
                      url.includes('favicon');

      if (isUploadRelated && !isNoise) {
        log(`    [CDP] Response: ${url.substring(0, 80)}...`);
        cdpResponseBodies.set(params.requestId, url); // Store URL for body retrieval
      }
    } catch { /* ignore */ }
  });

  // Track when file upload starts (to avoid capturing old history IDs)
  let fileUploadStarted = false;

  // Collect ALL mediaIds from history responses and URLs BEFORE upload
  // This is more reliable than the API call
  const idsBeforeUpload: Set<string> = new Set();
  let firstHistoryResponseCaptured = false;

  // CDP handler - capture mediaIds from URLs and history responses
  cdpClient.on('Network.responseReceived', async (params: Protocol.Network.ResponseReceivedEvent) => {
    try {
      const url = params.response?.url || '';
      if (!url || cdpCapturedMediaId) return;

      // Extract CAM ID from aisandbox URLs (e.g., .../media/CAMaJDxx...)
      // These URLs are fetched for image thumbnails
      if (url.includes('aisandbox-pa.googleapis.com/v1/media/CAM')) {
        const camIdMatch = url.match(/CAM[a-zA-Z0-9_-]{30,}/);
        if (camIdMatch) {
          const camId = camIdMatch[0];
          if (!fileUploadStarted) {
            // Before upload - track existing IDs
            idsBeforeUpload.add(camId);
          } else {
            // After upload - check if this is a NEW ID with CAMaJ format
            if (!idsBeforeUpload.has(camId) && !existingIds.includes(camId)) {
              // Only capture CAMaJ format - other formats don't work with video API
              if (camId.startsWith('CAMaJ')) {
                cdpCapturedMediaId = camId;
                log(`    [CDP] Captured NEW CAMaJ mediaId from URL: ${camId.substring(0, 40)}...`);
              } else {
                debug(`    [CDP] Skipping non-CAMaJ ID: ${camId.substring(0, 20)}...`);
              }
            }
          }
        }
      }
    } catch { /* ignore */ }
  });

  // CDP handler - also capture from history response bodies
  cdpClient.on('Network.loadingFinished', async (params: Protocol.Network.LoadingFinishedEvent) => {
    try {
      const url = cdpResponseBodies.get(params.requestId);
      if (!url || cdpCapturedMediaId) return;

      const isHistoryResponse = url.includes('fetchUserHistoryDirectly');

      if (!isHistoryResponse) return;

      const { body } = await cdpClient.send('Network.getResponseBody', {
        requestId: params.requestId
      }).catch(() => ({ body: '' }));

      if (body) {
        const idsInResponse = extractMediaIds(body);

        if (!fileUploadStarted) {
          // Before upload - collect all existing IDs
          idsInResponse.forEach(id => idsBeforeUpload.add(id));
          if (!firstHistoryResponseCaptured && idsInResponse.length > 0) {
            log(`    [CDP] Captured ${idsInResponse.length} existing IDs from history`);
            firstHistoryResponseCaptured = true;
          }
        } else {
          // After upload - find NEW IDs
          log(`    [CDP] History response after upload: ${idsInResponse.length} IDs, ${idsBeforeUpload.size} known`);
          const newIds = idsInResponse.filter(id =>
            !idsBeforeUpload.has(id) && !existingIds.includes(id)
          );
          if (newIds.length > 0) {
            // Prefer CAMaJ format - other formats don't work with video API
            const camaJIds = newIds.filter(id => id.startsWith('CAMaJ'));
            if (camaJIds.length > 0) {
              cdpCapturedMediaId = camaJIds[0];
              log(`    [CDP] Captured NEW CAMaJ mediaId from history: ${cdpCapturedMediaId.substring(0, 40)}...`);
            } else {
              log(`    [CDP] Found ${newIds.length} new IDs but none are CAMaJ format: ${newIds.map(id => id.substring(0, 5)).join(', ')}`);
            }
          } else {
            log(`    [CDP] No new IDs in history response`);
          }
        }
      }
    } catch (e) {
      debug(`    [CDP] History handler error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // Function to signal that file upload has started
  const markFileUploadStarted = () => {
    fileUploadStarted = true;
  };

  // Wait for Next.js app to hydrate and become interactive
  await Bun.sleep(3000);

  // Verify page loaded correctly
  const pageReady = await page.evaluate(() => {
    // Check for key elements that indicate page is ready
    const hasCombobox = document.querySelector('[role="combobox"]') !== null;
    const hasBody = document.body && document.body.innerHTML.length > 1000;
    return hasCombobox || hasBody;
  }).catch(() => false);

  if (!pageReady) {
    log(`    Page not ready, waiting more...`);
    await Bun.sleep(3000);
  }

  // CRITICAL: Fetch ALL existing media IDs from API BEFORE upload
  // This is more reliable than scraping DOM which may miss some IDs
  log(`    Fetching existing media IDs from API...`);
  const existingIds = await fetchUserMediaHistory(cookies, "IMAGE", 200);
  log(`    Found ${existingIds.length} existing mediaIds in library`);

  let capturedMediaId: string | null = null;

  const responseHandler = async (response: any) => {
    try {
      const method = response.request().method();
      const url = response.url();

      // Log upload-related requests (POST, PUT, PATCH)
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // Filter out noise: ignore static assets, fonts, analytics
        const isNoise = url.includes('.js') || url.includes('.css') || url.includes('.woff') ||
                        url.includes('analytics') || url.includes('reportClientSideError');
        if (!isNoise) {
          log(`    [Network] ${method}: ${url.substring(0, 100)}...`);
        }

        // Broaden capture: check any response that might contain a mediaId
        // Google uses various endpoints for uploads
        if (url.includes("upload") || url.includes("media") || url.includes("aisandbox") ||
            url.includes("googleapis.com") || url.includes("storage.google") ||
            url.includes("trpc") || url.includes("asset") || url.includes("grpc") ||
            url.includes("uploadUserImage") || url.includes("files/d/")) {
          // Add timeout to response.text() to prevent hangs
          const text = String(await withTimeout(
            response.text(),
            5000,
            "response.text() timeout"
          ).catch(() => ""));

          const allIds = extractMediaIds(text);
          const newIds = allIds.filter(id => !existingIds.includes(id));

          if (url.includes("upload") || url.includes("media") || url.includes("aisandbox")) {
            debug(`    [Network] Match: ${url}`);
            debug(`    [Network] IDs found: ${allIds.length}, New: ${newIds.length}`);
            if (allIds.length > 0) debug(`    [Network] Sample ID: ${allIds[0].substring(0, 20)}...`);
          }

          // Enhanced logging for uploadUserImage responses
          if (url.includes("uploadUserImage")) {
            log(`    [Upload Response] Found ${allIds.length} IDs total, ${newIds.length} new`);
            // Log all IDs found with their prefixes
            for (const id of allIds.slice(0, 5)) {
              const prefix = id.substring(0, 5);
              const isNew = newIds.includes(id);
              log(`      ID: ${prefix}... (${isNew ? 'NEW' : 'existing'})`);
            }
            // Prefer CAMaJ format if available
            const camaJIds = newIds.filter(id => id.startsWith('CAMaJ'));
            if (camaJIds.length > 0 && !capturedMediaId) {
              capturedMediaId = camaJIds[0];
              log(`    Captured CAMaJ mediaId from upload response: ${capturedMediaId.substring(0, 30)}...`);
            } else if (allIds.filter(id => id.startsWith('CAMaJ')).length > 0 && !capturedMediaId) {
              // Try existing CAMaJ IDs (dedup case)
              capturedMediaId = allIds.filter(id => id.startsWith('CAMaJ'))[0];
              log(`    Captured existing CAMaJ mediaId from upload response: ${capturedMediaId.substring(0, 30)}...`);
            }
          }

          if (newIds.length > 0 && !capturedMediaId) {
            // Prefer CAMaJ format if available
            const camaJNewIds = newIds.filter(id => id.startsWith('CAMaJ'));
            if (camaJNewIds.length > 0) {
              capturedMediaId = camaJNewIds[camaJNewIds.length - 1];
            } else {
              capturedMediaId = newIds[newIds.length - 1];
            }
            log(`    Captured mediaId from response: ${capturedMediaId.substring(0, 30)}...`);
            debug(`    Source URL: ${url}`);
          } else if (allIds.length > 0 && !capturedMediaId && url.includes("uploadUserImage")) {
            // If it's explicitly an upload response and we found IDs but they were already "seen",
            // it's possible it's a deduplicated asset. We'll take it if we have nothing else.
            // Prefer CAMaJ format
            const camaJIds = allIds.filter(id => id.startsWith('CAMaJ'));
            capturedMediaId = camaJIds.length > 0 ? camaJIds[camaJIds.length - 1] : allIds[allIds.length - 1];
            log(`    Captured previously seen mediaId from upload response (dedup?): ${capturedMediaId.substring(0, 30)}...`);
          }
        }
      }
    } catch {
      // Ignore errors from response processing
    }
  };

  const requestHandler = (request: any) => {
    try {
      const method = request.method();
      const url = request.url();

      if (method === 'POST') {
        const postData = request.postData();
        // Only capture from request payload as last resort - prefer response IDs
        // Skip uploadUserImage requests as those have the pre-cropped ID, not the final one
        if (postData && !capturedMediaId && !url.includes('uploadUserImage')) {
          const mediaId = extractMediaId(postData);
          // Only use IDs that start with CAMaJ (the standard format)
          if (mediaId && !existingIds.includes(mediaId) && mediaId.startsWith('CAMaJ')) {
            capturedMediaId = mediaId;
            log(`    Captured mediaId from request payload: ${mediaId.substring(0, 30)}...`);
            debug(`    Payload URL: ${url}`);
          }
        }
      }
    } catch {
      // Ignore errors from request processing
    }
  };

  // Listen for responses to capture mediaIds (no interception needed)
  page.on("response", responseHandler);
  page.on("request", requestHandler);

  // Helper functions using the generic finder
  const findButtonByText = (text: string, timeout = 5000) =>
    findElementByText(page, "button", text, timeout);

  const findOptionByText = (text: string, timeout = 3000) =>
    findElementByText(page, '[role="option"], [role="menuitem"], li', text, timeout);

  // Determine which mode to switch to based on uploadMode parameter
  const targetMode = uploadMode === "ingredients" ? "Ingredients to Video" : "Frames to Video";
  const modeCheckText = uploadMode === "ingredients" ? "ingredients" : "frames";

  try {
    // Switch to the appropriate mode by clicking the mode dropdown
    // Retry mode switch up to 3 times as it can be flaky
    for (let modeAttempt = 0; modeAttempt < 3; modeAttempt++) {
      try {
        // Check current mode first
        const currentModeText = await page.evaluate(() => {
          const combobox = document.querySelector('[role="combobox"]');
          return combobox?.textContent?.toLowerCase() || '';
        }).catch(() => '');

        if (currentModeText.includes(modeCheckText)) {
          log(`    Mode already set to ${targetMode}`);
          break;
        }

        const modeDropdown = await page.waitForSelector('[role="combobox"]', { timeout: 5000 });
        if (modeDropdown) {
          await modeDropdown.click();
          await Bun.sleep(500);

          const modeOption = await findOptionByText(targetMode);
          if (modeOption) {
            await modeOption.click();
            log(`    Switched to ${targetMode} mode`);
            await Bun.sleep(1000); // Wait for UI to update
            break;
          }
        }
      } catch (e: any) {
        log(`    Mode switch attempt ${modeAttempt + 1} failed: ${e.message?.substring(0, 50) || 'unknown'}`);
        if (modeAttempt < 2) {
          await Bun.sleep(500);
        }
      }
    }

    // Find and click the "+" add button to open image picker
    // Wait a bit for UI to stabilize after mode switch
    await Bun.sleep(1500);

    // Debug: Log the current page state
    const pageDebug = await page.evaluate(() => {
      const mode = document.querySelector('[role="combobox"]')?.textContent || 'unknown';
      const frameInputs = document.querySelectorAll('[class*="frame"], [class*="Frame"]');
      const addBtns = Array.from(document.querySelectorAll('button')).filter(b =>
        b.textContent?.toLowerCase().includes('add')
      );
      return {
        mode,
        frameInputCount: frameInputs.length,
        addButtonCount: addBtns.length,
        addButtonDetails: addBtns.slice(0, 3).map(b => ({
          text: b.textContent?.trim(),
          visible: b.offsetParent !== null,
          rect: b.getBoundingClientRect()
        }))
      };
    }).catch(() => ({ mode: 'error', frameInputCount: 0, addButtonCount: 0, addButtonDetails: [] }));
    log(`    Page state: mode="${pageDebug.mode}", frameInputs=${pageDebug.frameInputCount}, addButtons=${pageDebug.addButtonCount}`);

    const addButton = await findAddButton(page);
    if (addButton) {
      const btnInfo = await addButton.evaluate((el: Element) => ({
        text: el.textContent?.trim() || 'unknown',
        ariaLabel: el.getAttribute('aria-label') || '',
        rect: el.getBoundingClientRect()
      })).catch(() => ({ text: 'unknown', ariaLabel: '', rect: null }));
      log(`    Found add button: "${btnInfo.text || btnInfo.ariaLabel}" at y=${btnInfo.rect?.top || 'unknown'}`);

      // Use cursor click for more realistic interaction
      try {
        const box = await addButton.boundingBox();
        if (box) {
          // Click in the center of the button
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          log(`    Mouse clicked at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`);
        } else {
          await page.evaluate((el) => (el as HTMLElement).click(), addButton);
          log(`    Button clicked via JS (no bounding box)`);
        }
      } catch (e) {
        log(`    Initial click failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }

      // Wait for dialog to appear
      await Bun.sleep(2000);

      // Check for and handle the "Notice" / "I agree" dialog that may appear
      await handleNoticeDialog(page);

      // Check if dialog or overlay appeared
      let uiState = await getUIState(page);
      if (!uiState.hasDialog && !uiState.hasOverlay && !uiState.hasFileInput) {
        log(`    Picker didn't appear, re-finding and clicking button...`);
        const retryButton = await findAddButton(page);
        if (retryButton) {
          await retryButton.click().catch(() => debug(`    Fallback click failed`));
        }
        await Bun.sleep(2000);
        uiState = await getUIState(page);
      }

      log(`    UI state: dialog=${uiState.hasDialog}, overlay=${uiState.hasOverlay}, fileInput=${uiState.hasFileInput}`);

      // Strategy 1: Click-based upload via visible Upload box
      // NOTE: Programmatic uploadFile() doesn't work with Google Flow - it only shows a preview
      // but doesn't actually upload to Google servers. Must use click-based approach.
      if (uiState.hasFileInput || uiState.hasDialog || uiState.hasOverlay) {
        log(`    Using click-based upload (required for Google Flow)`);
        try {
          // Fix race condition (puppeteer issue #6040): pre-enable file chooser
          // interception. Reuses the CDP session created earlier instead of
          // reaching into the private `page._client()`.
          await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: true });
          log(`    FileChooser interception enabled`);

          // Click upload box first
          const clicked = await clickVisibleUploadBox(page);
          if (!clicked) {
            log(`    Upload box not found, clicking file input directly...`);
            const fi = await page.$('input[type="file"]');
            if (fi) {
              await page.evaluate((el) => (el as HTMLInputElement).click(), fi);
            }
          }

          // Check for and handle the "Notice" / "I agree" dialog
          await Bun.sleep(500);
          await handleNoticeDialog(page);

          // Now wait for FileChooser with a click on the upload area again if needed
          const [fileChooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 15000 }),
            (async () => {
              await Bun.sleep(300);
              // Click again to trigger the file chooser after dialog is dismissed
              await clickVisibleUploadBox(page);
            })()
          ]);

          // FileChooser.accept() often sets file.size=0 due to browser sandboxing
          // Instead, read the file content and create a proper File object
          log(`  Reading file content for upload...`);
          const fileContent = await Bun.file(imagePath).arrayBuffer();
          const fileName = imagePath.split('/').pop() || 'image.jpg';
          const mimeType = fileName.endsWith('.png') ? 'image/png' :
                           fileName.endsWith('.webp') ? 'image/webp' :
                           fileName.endsWith('.heic') ? 'image/heic' : 'image/jpeg';

          log(`    File: ${fileName}, size: ${fileContent.byteLength} bytes, type: ${mimeType}`);

          // Convert ArrayBuffer to base64 for transfer to browser
          const base64Content = Buffer.from(fileContent).toString('base64');

          // Create proper File object in browser and set it on the input
          const fileSetResult = await page.evaluate(
            ({ base64, name, type }) => {
              try {
                // Decode base64 to binary
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }

                // Create File object with actual content
                const file = new File([bytes], name, { type });
                console.log(`[veo-cli] Created File: ${file.name}, size: ${file.size}, type: ${file.type}`);

                // Find file input
                const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
                if (!fileInput) {
                  return { success: false, error: 'File input not found' };
                }

                // Use DataTransfer to set files on the input
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;

                console.log(`[veo-cli] Set files on input: ${fileInput.files?.length} file(s), size: ${fileInput.files?.[0]?.size}`);

                // Dispatch events to trigger React handlers
                const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                fileInput.dispatchEvent(changeEvent);

                const inputEvent = new Event('input', { bubbles: true, cancelable: true });
                fileInput.dispatchEvent(inputEvent);

                // Try to find and call React's onChange handler directly
                const reactPropsKey = Object.keys(fileInput).find(k =>
                  k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers')
                );
                if (reactPropsKey) {
                  const props = (fileInput as any)[reactPropsKey];
                  if (props?.onChange) {
                    console.log('[veo-cli] Calling React onChange directly...');
                    try {
                      props.onChange({ target: fileInput, currentTarget: fileInput, type: 'change' });
                    } catch (e) {
                      console.log('[veo-cli] React onChange call error:', e);
                    }
                  }
                }

                return {
                  success: true,
                  filesCount: fileInput.files?.length || 0,
                  fileSize: fileInput.files?.[0]?.size || 0,
                  fileName: fileInput.files?.[0]?.name || ''
                };
              } catch (e) {
                return { success: false, error: String(e) };
              }
            },
            { base64: base64Content, name: fileName, type: mimeType }
          ).catch((e) => ({ success: false, error: String(e) }));

          if (fileSetResult.success && "fileName" in fileSetResult) {
            log(`  File set on input: ${fileSetResult.fileName}, size: ${fileSetResult.fileSize} bytes`);
          } else {
            log(`    WARNING: Failed to set file on input: ${fileSetResult.error}`);
            // Fallback to FileChooser (might work in some cases)
            await fileChooser.accept([imagePath]);
            log(`    Fallback: Used FileChooser.accept()`);
          }

          // CRITICAL: Mark upload as started IMMEDIATELY so CDP captures new IDs
          log(`    Captured ${idsBeforeUpload.size} IDs before upload, now tracking new ones...`);
          markFileUploadStarted();

          // Take debug screenshot immediately after file selection
          await captureDebugScreenshot(page, "after-file-select");

          // Wait for the upload to actually complete
          // The upload to Google Cloud Storage takes several seconds
          log(`    Waiting for upload to complete...`);
          await Bun.sleep(8000); // Increased wait time

          // Take another screenshot after waiting
          await captureDebugScreenshot(page, "after-upload-wait");

          // Check if CDP already captured a new ID during the upload
          if (cdpCapturedMediaId) {
            log(`    CDP captured new ID during upload wait!`);
          }

          // After upload completes, find the newly uploaded image in the picker
          // The new image should appear at the TOP of the library (most recent first)
          const newlyUploadedId = await page.evaluate((existingIds: string[]) => {
            // Look for images in the picker that have CAM IDs we haven't seen before
            const allImages = document.querySelectorAll('img');
            const newIds: string[] = [];

            for (const img of Array.from(allImages)) {
              const src = img.getAttribute('src') || '';
              const dataSrc = img.getAttribute('data-src') || '';
              const fullSrc = src + dataSrc;

              // Extract CAM ID from the image src
              const match = fullSrc.match(/CAM[a-zA-Z0-9_-]{30,}/);
              if (match && !existingIds.includes(match[0])) {
                // Check if this image is visible (in the picker area)
                const rect = img.getBoundingClientRect();
                if (rect.width > 50 && rect.height > 50 && rect.top > 100) {
                  newIds.push(match[0]);
                }
              }
            }

            // Also check the __NEXT_DATA__ for new IDs
            const nextData = document.getElementById('__NEXT_DATA__');
            if (nextData) {
              const content = nextData.textContent || '';
              const matches = content.match(/CAM[a-zA-Z0-9_-]{30,}/g) || [];
              for (const m of matches) {
                if (!existingIds.includes(m) && !newIds.includes(m)) {
                  newIds.push(m);
                }
              }
            }

            // Return the first new ID found (most likely the upload)
            return newIds.length > 0 ? newIds[0] : null;
          }, existingIds).catch(() => null);

          if (newlyUploadedId) {
            log(`    Found new image ID: ${newlyUploadedId.substring(0, 40)}...`);
            // Only use CAMaJ format IDs - other formats don't work with video API
            if (newlyUploadedId.startsWith('CAMaJ')) {
              cdpCapturedMediaId = newlyUploadedId;
              log(`    Using CAMaJ format ID`);
            } else {
              log(`    Warning: ID format ${newlyUploadedId.substring(0, 5)}... may not work, waiting for CAMaJ format...`);
              // Don't set cdpCapturedMediaId yet, wait for proper format from response
            }
          } else {
            log(`    No new image found in picker via DOM, waiting for CDP...`);
            await Bun.sleep(2000);
          }

          // Debug: Log what buttons are visible after file selection
          const visibleButtons = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            return Array.from(buttons)
              .filter(b => b.offsetParent !== null)
              .map(b => (b.textContent || '').trim().substring(0, 30))
              .filter(t => t.length > 0);
          }).catch(() => []);
          log(`    Visible buttons after file select: ${visibleButtons.slice(0, 10).join(', ')}`);

          // Detect actual image orientation for crop selection
          const detected = detectImageOrientation(imagePath);
          const detectedOrientation = detected.orientation;
          if (detected.width && detected.height) {
            log(`    Detected image orientation: ${detectedOrientation} (${detected.width}x${detected.height})`);
          } else {
            log(`    Could not detect image dimensions, defaulting to: ${detectedOrientation}`);
          }

          // Handle crop dialog - first wait for it to appear
          const cropBtn = await findButtonByText("Crop and Save", 8000);
          if (cropBtn) {
            // Select correct aspect ratio based on image orientation
            try {
              await selectCropAspectRatio(page, detectedOrientation);
            } catch (e) {
              log(`    Error selecting aspect ratio: ${e instanceof Error ? e.message : String(e)}`);
            }

            // Click Crop and Save
            await cropBtn.click();
            log(`    Clicked Crop and Save button`);
            await Bun.sleep(3000);
          } else {
            log(`    No Crop and Save button found, trying alternatives...`);
            const saveBtn = await findButtonByText("Save", 2000);
            const doneBtn = await findButtonByText("Done", 2000);
            if (saveBtn) {
              await saveBtn.click();
              log(`    Clicked Save button`);
              await Bun.sleep(3000);
            } else if (doneBtn) {
              await doneBtn.click();
              log(`    Clicked Done button`);
              await Bun.sleep(3000);
            } else {
              // No crop/save button - upload might have completed directly
              // Wait a bit for upload to process
              log(`    No crop dialog, waiting for upload to process...`);
              await Bun.sleep(3000);

              // Check if image appeared in frame slot (extract mediaId from DOM)
              const frameSlotId = await page.evaluate((existingIds: string[]) => {
                // Look for frame slot elements that contain images
                const frameSlots = document.querySelectorAll('[class*="frame"], [class*="Frame"], [data-testid*="frame"]');
                for (const slot of Array.from(frameSlots)) {
                  // Check for img elements with src containing mediaId
                  const imgs = slot.querySelectorAll('img');
                  for (const img of Array.from(imgs)) {
                    const src = img.getAttribute('src') || '';
                    const match = src.match(/CAM[a-zA-Z0-9_-]{30,}/);
                    if (match && !existingIds.includes(match[0])) {
                      return match[0];
                    }
                  }
                  // Also check style background-image
                  const style = slot.getAttribute('style') || '';
                  const bgMatch = style.match(/CAM[a-zA-Z0-9_-]{30,}/);
                  if (bgMatch && !existingIds.includes(bgMatch[0])) {
                    return bgMatch[0];
                  }
                }
                // Also check all img elements on page
                const allImgs = document.querySelectorAll('img');
                for (const img of Array.from(allImgs)) {
                  const src = img.getAttribute('src') || '';
                  if (src.includes('googleusercontent.com') || src.includes('storage.google')) {
                    const match = src.match(/CAM[a-zA-Z0-9_-]{30,}/);
                    if (match && !existingIds.includes(match[0])) {
                      return match[0];
                    }
                  }
                }
                return null;
              }, existingIds).catch(() => null);

              if (frameSlotId) {
                log(`    Found mediaId in frame slot: ${frameSlotId.substring(0, 40)}...`);
                // Only use CAMaJ format - other formats don't work with video API
                if (frameSlotId.startsWith('CAMaJ')) {
                  cdpCapturedMediaId = frameSlotId;
                  log(`    Using CAMaJ format ID from frame slot`);
                } else {
                  log(`    Warning: Frame slot ID format ${frameSlotId.substring(0, 5)}... may not work`);
                }
              }
            }
          }

          // Wait for mediaId capture after crop/upload (check CDP, network handler, and DOM)
          // Prefer capturedMediaId (from upload request payload) over cdpCapturedMediaId (from DOM)
          // since the request payload ID is the actual upload, while DOM can have stale/cached IDs
          for (let i = 0; i < 30; i++) {
            if (capturedMediaId || cdpCapturedMediaId) {
              const mediaIdFound = capturedMediaId || cdpCapturedMediaId;
              log(`    MediaId captured: ${mediaIdFound!.substring(0, 30)}...`);
              return mediaIdFound!;
            }

            // Poll DOM for new CAM IDs that appeared after upload
            if (i % 3 === 0) { // Every 1.5 seconds
              const newDomId = await page.evaluate((existingIds: string[]) => {
                // Check ALL elements for CAM IDs in src, data attributes, or style
                const allElements = document.querySelectorAll('*');
                for (const el of Array.from(allElements)) {
                  // Check attributes
                  for (const attr of Array.from(el.attributes)) {
                    const match = attr.value.match(/CAM[a-zA-Z0-9_-]{30,}/);
                    if (match && !existingIds.includes(match[0])) {
                      return match[0];
                    }
                  }
                }
                // Also check __NEXT_DATA__ for any new IDs
                const nextData = document.getElementById('__NEXT_DATA__');
                if (nextData) {
                  const content = nextData.textContent || '';
                  const matches = content.match(/CAM[a-zA-Z0-9_-]{30,}/g) || [];
                  for (const m of matches) {
                    if (!existingIds.includes(m)) return m;
                  }
                }
                return null;
              }, existingIds).catch(() => null);

              if (newDomId) {
                log(`    Found NEW mediaId in DOM: ${newDomId.substring(0, 40)}...`);
                return newDomId;
              }
            }

            await Bun.sleep(500);
          }
        } catch (e) {
          log(`    Click-based upload failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }

      // Strategy 2: Manual click and file chooser (when dialog is visible)
      if (!capturedMediaId && uiState.hasDialog) {
        log(`    Proceeding to manual dialog flow...`);
        try {
          // Fix race condition (puppeteer issue #6040): pre-enable file chooser
          // interception. Reuses the CDP session created earlier instead of
          // reaching into the private `page._client()`.
          await cdpClient.send('Page.setInterceptFileChooserDialog', { enabled: true });

          const [fileChooser] = await Promise.all([
            page.waitForFileChooser({ timeout: 15000 }),
            (async () => {
              await Bun.sleep(300); // Small delay to ensure interception is ready
              // Find "Upload" button specifically in the dialog
              const upBtn = await findButtonByText("Upload", 3000);
              if (upBtn) {
                await upBtn.click();
              } else {
                await clickVisibleUploadBox(page);
              }
            })()
          ]);

          markFileUploadStarted(); // Signal CDP to start capturing new mediaIds
          await fileChooser.accept([imagePath]);
          log(`  Image file selected via file chooser fallback...`);

          for (let i = 0; i < 40; i++) {
            if (capturedMediaId) {
              const fallbackMediaId = capturedMediaId as string;
              log(`    MediaId captured from fallback: ${fallbackMediaId.substring(0, 30)}...`);
              break;
            }
            await Bun.sleep(500);
          }
        } catch (e) {
          log(`    Manual dialog flow failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    } else {
      const altAddBtn = await findElementByText(page, 'button, [role="button"]', 'add', 3000);
      if (altAddBtn) {
        await altAddBtn.click();
        log(`    Clicked alternative add button`);
      }
    }

    // Captured from network/polling? Good, but we still need to handle crop if it appeared
    if (capturedMediaId) {
      // Check if we still need to handle crop dialog
      const ui = await getUIState(page);
      if (ui.hasDialog || ui.hasOverlay) {
        log(`    MediaId captured but dialog still present, handling crop...`);
      } else {
        log(`    Skipping crop dialog, using captured mediaId`);
        return capturedMediaId;
      }
    }

    // Wait a bit more for UI to settle
    await Bun.sleep(1000);

    // Detect actual image orientation for crop selection
    const detected = detectImageOrientation(imagePath);
    const detectedOrientation = detected.orientation;
    if (detected.width && detected.height) {
      log(`    Detected image orientation: ${detectedOrientation} (${detected.width}x${detected.height})`);
    } else {
      log(`    Could not detect image dimensions, defaulting to: ${detectedOrientation}`);
    }

    // Wait for crop dialog and select aspect ratio based on detected image orientation
    const cropSaveBtn = await findButtonByText("Crop and Save", 8000);
    if (cropSaveBtn) {
      // Now that crop dialog is visible, select correct aspect ratio
      try {
        // Find the Landscape/Portrait dropdown by looking for button with that text
        const allButtons = await page.$$('button');
        let aspectDropdown = null;

        for (const btn of allButtons) {
          const text = await btn.evaluate(el => el.textContent || '').catch(() => '');
          if ((text.toLowerCase().includes('landscape') || text.toLowerCase().includes('portrait')) &&
              !text.toLowerCase().includes('crop and save')) {
            aspectDropdown = btn;
            log(`    Found aspect dropdown button with text: "${text.trim()}"`);
            break;
          }
        }

        if (aspectDropdown) {
          const dropdownText = await aspectDropdown.evaluate(el => el.textContent || '');
          if ((detectedOrientation === "portrait" && !dropdownText.toLowerCase().includes("portrait")) ||
            (detectedOrientation === "landscape" && !dropdownText.toLowerCase().includes("landscape"))) {
            log(`    Switching crop from ${dropdownText.trim()} to ${detectedOrientation}`);
            await aspectDropdown.click();
            await Bun.sleep(500);
            const option = await findOptionByText(detectedOrientation === "portrait" ? "Portrait" : "Landscape");
            if (option) {
              await option.click();
              log(`    Selected ${detectedOrientation} option`);
              await Bun.sleep(500);
            }
          }
        } else {
          log(`    No aspect dropdown found, proceeding with default`);
        }
      } catch (e) {
        log(`    Error selecting aspect ratio: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Click Crop and Save
      await cropSaveBtn.click();
      log(`  Image cropped and saved...`);
      await Bun.sleep(2000);
    }

    // Wait for any pending network activity
    await Bun.sleep(2000);

  } finally {
    // GUARANTEED cleanup of event handlers
    page.off('response', responseHandler);
    page.off('request', requestHandler);
    try {
      await page.setRequestInterception(false);
    } catch {
      // Page might be closed, ignore
    }
    try {
      await cdpClient.detach();
    } catch {
      // CDP client might already be detached, ignore
    }
  }

  // Check if we captured mediaId from network (prioritize request payload over DOM)
  let mediaId: string | null = capturedMediaId || cdpCapturedMediaId;

  // If not captured from network, try extracting from page
  if (!mediaId) {
    log(`    No mediaId from network, trying page extraction...`);

    try {
      const extractionResult = await page.evaluate(() => {
        const pageText = document.body.innerHTML;
        const camMatches = pageText.match(/CAM[a-zA-Z0-9_-]{30,}/g);

        // Check Next.js data
        const nextData = document.getElementById('__NEXT_DATA__');
        let nextDataMatches: string[] = [];
        if (nextData) {
          const content = nextData.textContent || '';
          nextDataMatches = content.match(/CAM[a-zA-Z0-9_-]{30,}/g) || [];
        }

        // Check all attributes for CAM IDs
        const allElements = document.querySelectorAll('*');
        const attrMatches: string[] = [];
        for (const el of Array.from(allElements)) {
          for (const attr of Array.from(el.attributes)) {
            const m = attr.value.match(/CAM[a-zA-Z0-9_-]{30,}/g);
            if (m) attrMatches.push(...m);
          }
        }

        return {
          camMatches: camMatches ? [...new Set(camMatches)] : [],
          nextDataMatches: [...new Set(nextDataMatches)],
          attrMatches: [...new Set(attrMatches)]
        };
      });

      const nextDataMatches = extractionResult.nextDataMatches.filter(id => !existingIds.includes(id));
      const camMatches = extractionResult.camMatches.filter(id => !existingIds.includes(id));
      const attrMatches = extractionResult.attrMatches.filter(id => !existingIds.includes(id));

      // Prefer CAMaJ format IDs - other formats don't work with video API
      const camaJNextData = nextDataMatches.filter(id => id.startsWith('CAMaJ'));
      const camaJAttr = attrMatches.filter(id => id.startsWith('CAMaJ'));
      const camaJCam = camMatches.filter(id => id.startsWith('CAMaJ'));

      if (camaJNextData.length > 0) {
        mediaId = camaJNextData[camaJNextData.length - 1] ?? null;
      } else if (camaJAttr.length > 0) {
        mediaId = camaJAttr[camaJAttr.length - 1] ?? null;
      } else if (camaJCam.length > 0) {
        mediaId = camaJCam[camaJCam.length - 1] ?? null;
      }

      // Log if we found non-CAMaJ IDs but couldn't use them
      if (!mediaId && (nextDataMatches.length > 0 || attrMatches.length > 0 || camMatches.length > 0)) {
        log(`    Found IDs but none in CAMaJ format (page extraction):`);
        log(`      nextData: ${nextDataMatches.map(id => id.substring(0, 5)).join(', ') || 'none'}`);
        log(`      attr: ${attrMatches.map(id => id.substring(0, 5)).join(', ') || 'none'}`);
        log(`      cam: ${camMatches.map(id => id.substring(0, 5)).join(', ') || 'none'}`);
      }
    } catch {
      // Page might be in bad state, continue with null mediaId
    }
  }

  // CRITICAL: API-based fallback - most reliable method
  // Fetch current media history and find the NEW ID that wasn't there before
  if (!mediaId) {
    log(`    Trying API-based detection of uploaded image...`);
    await Bun.sleep(2000); // Give server time to process upload

    const currentIds = await fetchUserMediaHistory(cookies, "IMAGE", 200);
    const newIds = currentIds.filter(id => !existingIds.includes(id));

    if (newIds.length > 0) {
      // Prefer CAMaJ format - other formats don't work with video API
      const camaJIds = newIds.filter(id => id.startsWith('CAMaJ'));
      if (camaJIds.length > 0) {
        mediaId = camaJIds[0] ?? null;
        if (mediaId) {
          log(`    Found NEW CAMaJ mediaId via API: ${mediaId.substring(0, 40)}...`);
        }
      } else {
        log(`    Found ${newIds.length} new IDs via API but none in CAMaJ format: ${newIds.map(id => id.substring(0, 5)).join(', ')}`);
      }
    } else {
      log(`    No new IDs found via API (current: ${currentIds.length}, existing: ${existingIds.length})`);
    }
  }

  if (!mediaId) {
    // Capture screenshot for debugging
    await captureDebugScreenshot(page, "upload-failed");
    throw new Error("Failed to extract CAMaJ format mediaGenerationId from uploaded image. The video API only accepts CAMaJ format IDs. Try uploading a different image or check the logs for captured ID formats.");
  }

  log(`  Got mediaId: ${mediaId.substring(0, 40)}...`);
  return mediaId;
}

/**
 * Upload multiple images for Ingredients to Video mode in a single session.
 * This navigates to Flow once, switches to Ingredients mode, and uploads all images
 * by clicking the "+" button between uploads.
 * @param page - Puppeteer page
 * @param imagePaths - Array of image paths to upload (1-3 images)
 * @param cookies - Browser cookies
 * @param aspectRatio - Aspect ratio for cropping
 * @param existingProject - Optional existing project to use
 * @returns Array of mediaIds for all uploaded images
 */
export async function uploadMultipleIngredientsViaFlow(
  page: PageWithCursor,
  imagePaths: string[],
  cookies: Cookie[],
  aspectRatio: "landscape" | "portrait",
  existingProject?: Project
): Promise<string[]> {
  if (imagePaths.length === 0) {
    throw new Error("No images provided for ingredients upload");
  }
  if (imagePaths.length > 3) {
    throw new Error("Ingredients mode supports maximum 3 images");
  }

  log(`  Uploading ${imagePaths.length} images for Ingredients mode...`);

  let project = existingProject;

  if (!project) {
    const timestamp = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const projectTitle = `[Ingredients Upload ${timestamp}]`;
    log(`    Creating fresh project: ${projectTitle}`);

    const result = await createProject(cookies, projectTitle, "PINHOLE");
    project = result.project;
  }

  log(`    Using project for upload: ${project.projectId.substring(0, 8)}...`);

  const mediaIds: string[] = [];
  const projectUrl = `https://labs.google/fx/tools/flow/project/${project.projectId}`;

  // Navigate to project page
  log(`    Navigating to project page...`);
  await page.goto(projectUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await Bun.sleep(3000);

  // Switch to Ingredients to Video mode
  log(`    Switching to Ingredients to Video mode...`);
  for (let modeAttempt = 0; modeAttempt < 3; modeAttempt++) {
    try {
      const currentModeText = await page.evaluate(() => {
        const combobox = document.querySelector('[role="combobox"]');
        return combobox?.textContent?.toLowerCase() || '';
      }).catch(() => '');

      if (currentModeText.includes('ingredients')) {
        log(`    Mode already set to Ingredients to Video`);
        break;
      }

      const modeDropdown = await page.waitForSelector('[role="combobox"]', { timeout: 5000 });
      if (modeDropdown) {
        await modeDropdown.click();
        await Bun.sleep(500);

        // Find and click Ingredients to Video option using coordinates
        const ingredientsCoords = await page.evaluate(() => {
          const options = document.querySelectorAll('[role="option"], [role="menuitem"], li');
          for (const opt of Array.from(options)) {
            if (opt.textContent?.includes('Ingredients to Video')) {
              const rect = opt.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              }
            }
          }
          return null;
        });

        if (ingredientsCoords) {
          await page.mouse.click(ingredientsCoords.x, ingredientsCoords.y);
          log(`    Switched to Ingredients to Video mode`);
          await Bun.sleep(1500);
          break;
        }
      }
    } catch (e: any) {
      log(`    Mode switch attempt ${modeAttempt + 1} failed: ${e.message?.substring(0, 50) || 'unknown'}`);
      if (modeAttempt < 2) await Bun.sleep(500);
    }
  }

  // Set up CDP response listener to capture mediaIds
  const capturedMediaIds = new Set<string>();
  const cdpSession = await page.createCDPSession();

  await cdpSession.send('Network.enable');
  cdpSession.on('Network.responseReceived', async (params: Protocol.Network.ResponseReceivedEvent) => {
    try {
      if (params.response.url.includes('uploadUserImage')) {
        const response = await cdpSession.send('Network.getResponseBody', {
          requestId: params.requestId,
        }).catch(() => null);

        if (response?.body) {
          const matches = response.body.match(/CAMaJ[a-zA-Z0-9_-]{30,}/g);
          if (matches) {
            matches.forEach((id: string) => capturedMediaIds.add(id));
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  });

  // Also intercept request payloads for mediaId
  cdpSession.on('Network.requestWillBeSent', (params: Protocol.Network.RequestWillBeSentEvent) => {
    if (params.request.url.includes('uploadUserImage') && params.request.postData) {
      const matches = params.request.postData.match(/CAMaJ[a-zA-Z0-9_-]{30,}/g);
      if (matches) {
        matches.forEach((id: string) => capturedMediaIds.add(id));
      }
    }
  });

  // Upload each image
  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i];
    if (!imagePath) continue;
    log(`    Uploading ingredient ${i + 1}/${imagePaths.length}: ${imagePath.split('/').pop()}`);

    // For images after the first, click the "+" button to add another slot
    if (i > 0) {
      log(`    Clicking + button to add ingredient slot...`);
      await Bun.sleep(1000);

      // Find the add button coordinates
      const addBtnCoords = await page.evaluate(() => {
        // Look for + button or add button
        const buttons = document.querySelectorAll('button');
        for (const btn of Array.from(buttons)) {
          const text = btn.textContent?.toLowerCase() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
          if (text.includes('add') || ariaLabel.includes('add') ||
              btn.innerHTML.includes('add_circle') ||
              btn.innerHTML.includes('add_photo')) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
          }
        }
        // Also look for elements with + icon
        const plusIcons = document.querySelectorAll('[class*="add"], [aria-label*="add"]');
        for (const icon of Array.from(plusIcons)) {
          const rect = icon.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return null;
      });

      if (addBtnCoords) {
        log(`    Clicking add button at (${Math.round(addBtnCoords.x)}, ${Math.round(addBtnCoords.y)})`);
        await page.mouse.click(addBtnCoords.x, addBtnCoords.y);
        await Bun.sleep(1500);
      } else {
        log(`    Warning: Could not find add button for ingredient ${i + 1}`);
      }
    }

    // Find and click the upload area
    const capturedBefore = capturedMediaIds.size;

    // Set up file chooser handler
    const fileChooserPromise = page.waitForFileChooser({ timeout: 15000 }).catch(() => null);

    // Click the upload area - use coordinates-based click for reliability
    const uploadCoords = await page.evaluate(() => {
      // Look for the "+" button or upload area in ingredients mode
      const addButtons = document.querySelectorAll('button');
      for (const btn of Array.from(addButtons)) {
        const text = btn.textContent?.toLowerCase() || '';
        const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
        if (text.includes('add') || ariaLabel.includes('add')) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      // Look for upload areas
      const uploadAreas = document.querySelectorAll('[class*="upload"], [class*="Upload"], [class*="dropzone"]');
      for (const area of Array.from(uploadAreas)) {
        const rect = area.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      // Default position for ingredients upload area
      return { x: 220, y: 400 };
    });

    log(`    Clicking upload area at (${Math.round(uploadCoords.x)}, ${Math.round(uploadCoords.y)})`);
    await page.mouse.click(uploadCoords.x, uploadCoords.y);

    // Wait for file chooser and upload
    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      const fullPath = imagePath.startsWith('/') ? imagePath : join(process.cwd(), imagePath);
      await fileChooser.accept([fullPath]);
      log(`    File selected: ${imagePath.split('/').pop()}`);
    } else {
      log(`    Warning: No file chooser appeared for ingredient ${i + 1}`);
      continue;
    }

    // Wait for crop dialog and handle it
    await Bun.sleep(2000);

    // Check for crop dialog and handle it
    const hasCropDialog = await page.evaluate(() => {
      return document.querySelector('[class*="crop"], [class*="Crop"], [data-testid*="crop"]') !== null ||
             document.querySelector('button')?.textContent?.toLowerCase().includes('crop');
    });

    if (hasCropDialog) {
      log(`    Handling crop dialog...`);
      await Bun.sleep(500);

      // Click Crop and Save button
      const saveCoords = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of Array.from(buttons)) {
          const text = btn.textContent?.toLowerCase() || '';
          if ((text.includes('crop') && text.includes('save')) ||
              text.includes('save') || text.includes('done') || text.includes('apply')) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
          }
        }
        return null;
      });

      if (saveCoords) {
        log(`    Clicking save button at (${Math.round(saveCoords.x)}, ${Math.round(saveCoords.y)})`);
        await page.mouse.click(saveCoords.x, saveCoords.y);
        await Bun.sleep(1000);
      }
    }

    // Wait for upload to complete and mediaId to be captured
    await Bun.sleep(3000);

    // Check if new mediaId was captured
    const newIds = Array.from(capturedMediaIds).filter(id =>
      !mediaIds.includes(id) && id.startsWith('CAMaJ')
    );

    if (newIds.length > 0) {
      const newId = newIds[0];
      if (newId) {
        mediaIds.push(newId);
        log(`    Captured mediaId: ${newId.substring(0, 40)}...`);
      }
    } else {
      log(`    Warning: No new mediaId captured for ingredient ${i + 1}`);
    }
  }

  // Clean up CDP session
  await cdpSession.detach().catch(() => {});

  if (mediaIds.length !== imagePaths.length) {
    log(`    Warning: Expected ${imagePaths.length} mediaIds but got ${mediaIds.length}`);
  }

  log(`  Completed ingredients upload: ${mediaIds.length} images`);
  return mediaIds;
}

// ============================================================================
// Cached Upload Wrapper
// ============================================================================

/**
 * Upload image with caching - checks cache before uploading
 * Returns cached mediaId if available, otherwise uploads and caches result
 *
 * @param page - Puppeteer page (for direct backend)
 * @param imagePath - Path to image file
 * @param cookies - Browser cookies
 * @param aspectRatio - Target aspect ratio for cropping
 * @param existingProject - Optional project to use
 * @param uploadMode - "frames" or "ingredients"
 * @returns mediaId (from cache or fresh upload)
 */
export async function uploadImageWithCache(
  page: PageWithCursor,
  imagePath: string,
  cookies: Cookie[],
  aspectRatio: "landscape" | "portrait",
  existingProject?: Project,
  uploadMode: "frames" | "ingredients" = "frames"
): Promise<{ mediaId: string; fromCache: boolean }> {
  // Read file and compute hash
  const absolutePath = imagePath.startsWith("/") ? imagePath : join(process.cwd(), imagePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const fileContent = await Bun.file(absolutePath).arrayBuffer();
  const fileHash = hashFileContents(fileContent);
  const fileSize = fileContent.byteLength;

  // Check cache
  const cached = getImageCache(fileHash, aspectRatio, "direct");
  if (cached) {
    log(`  📦 Using cached mediaId for ${imagePath.split("/").pop()} (hash: ${fileHash.substring(0, 8)}...)`);
    return { mediaId: cached.media_id, fromCache: true };
  }

  // Upload image
  log(`  ⬆️ Uploading ${imagePath.split("/").pop()} (hash: ${fileHash.substring(0, 8)}...)`);
  const mediaId = await uploadImageViaFlow(
    page,
    imagePath,
    cookies,
    aspectRatio,
    existingProject,
    uploadMode
  );

  // Store in cache
  setImageCache({
    file_hash: fileHash,
    media_id: mediaId,
    file_path: absolutePath,
    file_size: fileSize,
    aspect_ratio: aspectRatio,
    backend: "direct",
  });

  log(`  ✅ Cached mediaId for future use`);
  return { mediaId, fromCache: false };
}
