/**
 * Authentication and reCAPTCHA module for veo-cli
 */

import type { PageWithCursor } from "puppeteer-real-browser";
import type { Cookie } from "rebrowser-puppeteer-core";
import { checkAuthValid } from "./api";

// Fallback site key in case dynamic extraction fails
const FALLBACK_RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

// Cache for the dynamically extracted site key
let cachedSiteKey: string | null = null;

/**
 * Extract reCAPTCHA site key from page
 */
export async function extractRecaptchaSiteKey(page: PageWithCursor): Promise<string | null> {
  const siteKey = await page.evaluate(() => {
    // Try to get from grecaptcha config
    const cfg = (window as any).___grecaptcha_cfg;
    if (cfg?.clients) {
      const clientKey = Object.keys(cfg.clients)[0];
      const key = cfg.clients[clientKey]?.j?.j?.sitekey;
      if (key) return key;
    }
    // Fallback: extract from script tag
    const script = document.querySelector('script[src*="recaptcha/enterprise.js"]');
    if (script) {
      const match = script.getAttribute('src')?.match(/render=([^&]+)/);
      if (match) return match[1];
    }
    return null;
  });
  return siteKey;
}

/**
 * Get reCAPTCHA token for API calls
 */
export async function getRecaptchaToken(
  page: PageWithCursor,
  action: string = "FLOW_GENERATION"
): Promise<string> {
  // Get site key dynamically or use cached/fallback
  let siteKey = cachedSiteKey;
  if (!siteKey) {
    siteKey = await extractRecaptchaSiteKey(page);
    if (siteKey) {
      cachedSiteKey = siteKey;
    } else {
      console.log("Warning: Could not extract reCAPTCHA site key, using fallback");
      siteKey = FALLBACK_RECAPTCHA_SITE_KEY;
    }
  }

  const token = await page.evaluate(
    async (key: string, actionName: string) => {
      // @ts-ignore
      if (typeof grecaptcha === "undefined" || !grecaptcha.enterprise) {
        throw new Error("grecaptcha.enterprise not available");
      }
      // @ts-ignore
      return await grecaptcha.enterprise.execute(key, { action: actionName });
    },
    siteKey,
    action
  );

  if (!token) {
    throw new Error("Failed to get reCAPTCHA token");
  }
  return token;
}

/**
 * Check if user is logged in to Google Flow
 */
export async function checkLoggedIn(page: PageWithCursor): Promise<boolean> {
  const startButton = await page.$(
    'xpath=//*[@id="hero"]/div[1]/div[2]/button'
  );
  return !Boolean(startButton);
}

/**
 * Clear cached site key (for testing or re-authentication)
 */
export function clearCachedSiteKey(): void {
  cachedSiteKey = null;
}

/**
 * Validate session by testing cookies against API
 * Returns true if cookies are valid for API access
 */
export async function validateSession(cookies: Cookie[]): Promise<boolean> {
  return checkAuthValid(cookies);
}
