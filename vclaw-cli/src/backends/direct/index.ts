/**
 * Direct Backend for veo-cli
 * Uses Puppeteer browser automation to interact with Google Labs Flow
 */

import { join } from "path";
import { existsSync } from "fs";
import type { Cookie } from "rebrowser-puppeteer-core";
import type { Browser } from "rebrowser-puppeteer-core";
import type { PageWithCursor } from "puppeteer-real-browser";
import type { Operation, Project, Session, VideoAspectRatio } from "../../types";
import type {
  BackendInitOptions,
  DirectResources,
  HealthResult,
  VideoRequest,
  VideoGenerationResult,
  ImageUploadResult,
  AccountTier,
  CostEstimate,
  VideoBackend,
} from "../types";

// Import existing modules
import {
  TARGET_PAGE_URL,
  filterCookiesByUrlDomain,
  searchAllUserProjects,
  createProject,
  setLastSelectedVideoModelKey,
  setLastSelectedVideoAspectRatio,
  getUserPaygateTier,
  performHealthChecks,
} from "../../api";
import { getRecaptchaToken, checkLoggedIn, validateSession } from "../../auth";
import { uploadImageViaFlow } from "../../upload";
import {
  createVideoText,
  createVideoImage,
  createVideoFrames,
  createVideoIngredients,
  setGenerationUserAgent,
} from "../../generation";
import { mapModelKey, log } from "../../config";
import { setUserAgent } from "../../download";
import { setApiUserAgent } from "../../api";

/**
 * Direct Backend implementation
 * Uses browser automation for video generation via Google Labs Flow
 */
export class DirectBackend implements VideoBackend {
  readonly name = "direct" as const;
  readonly requiresBrowser = true;

  private options: BackendInitOptions;
  private browser: Browser | null = null;
  private page: PageWithCursor | null = null;
  private cookies: Cookie[] = [];
  private session: Session | null = null;
  private project: Project | null = null;
  private userAgent: string = "";
  private paygateTier: string = "";
  private initialized = false;

  constructor(options: BackendInitOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Lazy load puppeteer-real-browser
    const { connect } = await import("puppeteer-real-browser");

    const headless = this.options.headless ?? this.options.config.direct?.headless ?? true;
    const cookiesPath = this.options.cookiesPath ?? this.options.config.direct?.cookiesPath ?? "./cookie.json";

    // Connect to browser
    const { page, browser } = await connect({
      headless,
      connectOption: {
        defaultViewport: null,
      },
    });

    this.browser = browser;
    this.page = page;

    // Load cookies
    const fullCookiePath = join(process.cwd(), cookiesPath);
    if (!existsSync(fullCookiePath)) {
      throw new Error(`Cookie file not found: ${cookiesPath}. Run with --visible to login first.`);
    }

    const cookieFile = Bun.file(fullCookiePath);
    let jsonCookie = await cookieFile.json();
    if (typeof jsonCookie === "object" && "cookies" in jsonCookie) {
      jsonCookie = jsonCookie.cookies;
    }

    await browser.setCookie(...jsonCookie);

    // Navigate to Flow
    await page.goto(TARGET_PAGE_URL.href, { waitUntil: "load" });

    // Check login status
    const pageShowsLoggedIn = await checkLoggedIn(page);
    const browserCookies = await browser.cookies();
    const filteredCookies = filterCookiesByUrlDomain(browserCookies, TARGET_PAGE_URL);

    let cookiesValid = false;
    if (pageShowsLoggedIn) {
      cookiesValid = await validateSession(filteredCookies);
    }

    if (!pageShowsLoggedIn || !cookiesValid) {
      const loginWaitMs = this.options.loginWaitMs ?? this.options.config.direct?.loginWaitMs ?? 60000;
      console.log(`Please log in within ${loginWaitMs / 1000} seconds`);
      await Bun.sleep(loginWaitMs);

      // Save new cookies
      const newCookies = await browser.cookies();
      const pageCookies = filterCookiesByUrlDomain(newCookies, TARGET_PAGE_URL);
      await cookieFile.write(JSON.stringify(pageCookies));

      console.log("Restart to continue with new cookies");
      await this.shutdown();
      throw new Error("Login required - cookies have been updated. Please restart.");
    }

    // Get browser user agent and propagate to all modules
    // Using page.evaluate to get navigator.userAgent from browser context
    this.userAgent = String(await page.evaluate("navigator.userAgent"));
    setUserAgent(this.userAgent);
    setApiUserAgent(this.userAgent);
    setGenerationUserAgent(this.userAgent);

    // Update cookies
    this.cookies = filteredCookies;
    const updatedCookieFile = Bun.file(fullCookiePath);
    await updatedCookieFile.write(JSON.stringify(this.cookies));

    // Get or create project
    const projects = await searchAllUserProjects(this.cookies);
    let project = projects.find(p => p.projectInfo.toolName === "PINHOLE");

    if (!project) {
      log("No PINHOLE project found, creating fresh one...");
      const { project: newProject } = await createProject(
        this.cookies,
        `[Veo CLI] ${new Date().toLocaleDateString()}`,
        "PINHOLE"
      );
      project = newProject;
    }

    this.project = project;
    log(`Using project: [${project.projectInfo.projectTitle}] ${project.projectId}`);

    // Navigate to project page
    const startProjectUrl = `${TARGET_PAGE_URL.href}/project/${project.projectId}`;
    await page.goto(startProjectUrl, { waitUntil: "load" });

    // Get session from page's __NEXT_DATA__ script element
    const nextData = await page.evaluate("document.getElementById('__NEXT_DATA__')?.textContent");
    if (!nextData) {
      throw new Error("Could not find __NEXT_DATA__ on page");
    }
    const parsedData = JSON.parse(String(nextData));
    this.session = parsedData.props.pageProps.session;

    // Get paygate tier
    const paygateTierResult = await getUserPaygateTier(this.session!);
    this.paygateTier = paygateTierResult.userPaygateTier;

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.initialized = false;
  }

  async checkHealth(): Promise<HealthResult> {
    if (!this.initialized) {
      return {
        healthy: false,
        message: "Backend not initialized",
      };
    }

    const health = await performHealthChecks(this.cookies);

    return {
      healthy: health.cookiesValid && health.networkReachable,
      message: health.errors.length > 0 ? health.errors.join("; ") : "OK",
      accountTier: "unknown" as AccountTier,
    };
  }

  async getAccountTier(): Promise<AccountTier> {
    // Direct backend doesn't have a way to determine tier before generation
    return "unknown";
  }

  async uploadImage(path: string, mode: "frames" | "ingredients"): Promise<ImageUploadResult> {
    if (!this.initialized || !this.page) {
      throw new Error("Backend not initialized");
    }

    // Determine crop aspect based on a default (could be enhanced to take as parameter)
    const cropAspect = "landscape";

    const mediaId = await uploadImageViaFlow(
      this.page,
      path,
      this.cookies,
      cropAspect,
      this.project!,
      mode
    );

    return { mediaId };
  }

  async generateVideo(request: VideoRequest): Promise<VideoGenerationResult> {
    if (!this.initialized || !this.page || !this.session || !this.project) {
      throw new Error("Backend not initialized");
    }

    // Get fresh reCAPTCHA token
    const recaptchaToken = await getRecaptchaToken(this.page);

    const aspectRatio = request.aspectRatio;
    const videoModelKey = mapModelKey(request.model, request.type, aspectRatio);

    // Update user settings for model and aspect ratio
    await setLastSelectedVideoModelKey(this.cookies, this.project, videoModelKey);
    await setLastSelectedVideoAspectRatio(this.cookies, this.project, aspectRatio);

    const baseOptions = {
      project: this.project,
      aspectRatio,
      videoModelKey,
      isSeedLocked: request.isSeedLocked ?? false,
      outputsPerPrompt: request.outputsPerPrompt ?? 1,
      requestTimeoutMs: 30000,
      userPaygateTier: this.paygateTier,
      recaptchaToken,
    };

    let operations: Operation[];

    switch (request.type) {
      case "text": {
        operations = await createVideoText(this.session, request.prompt, baseOptions);
        break;
      }

      case "image": {
        // Get I2V model key
        const i2vModelKey = "veo_3_1_i2v_s";
        // I2V only supports landscape via API
        const i2vOpts = {
          ...baseOptions,
          videoModelKey: i2vModelKey,
          aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE" as VideoAspectRatio,
          mediaIngestionDelayMs: 5000,
        };

        // Get or upload start image
        let startImageId: string;
        if (request.startImageMediaId) {
          startImageId = request.startImageMediaId;
        } else if (request.startImagePath) {
          const result = await this.uploadImage(request.startImagePath, "frames");
          startImageId = result.mediaId;
        } else {
          throw new Error("I2V request requires startImagePath or startImageMediaId");
        }

        operations = await createVideoImage(this.session, request.prompt, {
          ...i2vOpts,
          startImageId,
        });
        break;
      }

      case "frames": {
        // Get frames model key (with _fl suffix)
        const framesModelKey = mapModelKey(request.model, "frames", aspectRatio);
        // Frames only supports landscape via API
        const framesOpts = {
          ...baseOptions,
          videoModelKey: framesModelKey,
          aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE" as VideoAspectRatio,
          mediaIngestionDelayMs: 5000,
        };

        // Get or upload start image
        let startImageId: string;
        if (request.startImageMediaId) {
          startImageId = request.startImageMediaId;
        } else if (request.startImagePath) {
          const result = await this.uploadImage(request.startImagePath, "frames");
          startImageId = result.mediaId;
        } else {
          throw new Error("Frames request requires startImagePath or startImageMediaId");
        }

        // Get or upload end image
        let endImageId: string;
        if (request.endImageMediaId) {
          endImageId = request.endImageMediaId;
        } else if (request.endImagePath) {
          const result = await this.uploadImage(request.endImagePath, "frames");
          endImageId = result.mediaId;
        } else {
          throw new Error("Frames request requires endImagePath or endImageMediaId");
        }

        operations = await createVideoFrames(this.session, request.prompt, {
          ...framesOpts,
          startImageId,
          endImageId,
        });
        break;
      }

      case "ingredients": {
        // Get R2V model key
        const ingredientsModelKey = mapModelKey(request.model, "ingredients", aspectRatio);
        const ingredientsOpts = {
          ...baseOptions,
          videoModelKey: ingredientsModelKey,
          mediaIngestionDelayMs: 5000,
        };

        // Get or upload reference images
        const referenceImageIds: string[] = [];
        if (request.referenceImageMediaIds && request.referenceImageMediaIds.length > 0) {
          referenceImageIds.push(...request.referenceImageMediaIds);
        } else if (request.referenceImagePaths && request.referenceImagePaths.length > 0) {
          for (const imgPath of request.referenceImagePaths) {
            const result = await this.uploadImage(imgPath, "ingredients");
            referenceImageIds.push(result.mediaId);
          }
        } else {
          throw new Error("Ingredients request requires referenceImagePaths or referenceImageMediaIds");
        }

        operations = await createVideoIngredients(this.session, request.prompt, {
          ...ingredientsOpts,
          referenceImageIds,
        });
        break;
      }

      default:
        throw new Error(`Unknown request type: ${(request as any).type}`);
    }

    return { operations };
  }

  estimateCost(_request: VideoRequest): CostEstimate | null {
    // Direct backend has no monetary cost (uses Google credits)
    return null;
  }

  getDirectResources(): DirectResources | null {
    if (!this.initialized || !this.page || !this.session || !this.project) {
      return null;
    }
    return {
      page: this.page,
      cookies: this.cookies,
      session: this.session,
      project: this.project,
    };
  }
}
