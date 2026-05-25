/**
 * Account management commands for useapi.net backend
 * Provides CLI subcommands for managing useapi.net accounts
 */

import { UseApiClient } from "./client";
import type { UseApiCaptchaConfig } from "../types";

/**
 * Format session expiry timestamp into a concise column string
 */
function formatSessionColumn(expiresIso: string | undefined): string {
  if (!expiresIso) {
    return "-- unknown --";
  }

  const expiresDate = new Date(expiresIso);
  const now = new Date();
  const msRemaining = expiresDate.getTime() - now.getTime();

  if (msRemaining <= 0) {
    return "✗ Expired";
  }

  const hoursRemaining = Math.round((msRemaining / (1000 * 60 * 60)) * 10) / 10;
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  if (msRemaining < SIX_HOURS_MS) {
    return `⚠ ${hoursRemaining}h remaining`;
  }

  return `✓ ${hoursRemaining}h remaining`;
}

/**
 * Format session status line for health check display
 */
function formatSessionStatusLine(session: {
  status: "active" | "expiring_soon" | "expired" | "unknown";
  hoursRemaining: number | null;
  nextRefresh: string | null;
}): string {
  switch (session.status) {
    case "active":
      return `Session: ✓ Active (expires in ${session.hoursRemaining}h)`;
    case "expiring_soon":
      return `Session: ⚠ Expiring soon (${session.hoursRemaining}h remaining) — re-register cookies`;
    case "expired":
      return `Session: ✗ Expired — re-register cookies with: useapi:accounts add --cookies ...`;
    case "unknown":
      return `Session: -- Unable to determine session status`;
    default:
      return `Session: -- Unable to determine session status`;
  }
}

/**
 * List all accounts registered with useapi.net
 */
export async function listAccounts(client: UseApiClient): Promise<void> {
  console.log("\n=== useapi.net Accounts ===\n");

  try {
    const response = await client.getAccounts();
    const emails = Object.keys(response);

    if (emails.length === 0) {
      console.log("No accounts registered.");
      console.log("\nTo add an account:");
      console.log("  1. Export cookies from Chrome DevTools > Application > Cookies > accounts.google.com");
      console.log("  2. Save as tab-separated text file");
      console.log("  3. Run: bun run flow.ts useapi:accounts add --cookies ./google-cookies.txt");
      console.log("\n  For detailed setup instructions:");
      console.log("    bun run flow.ts useapi:accounts export-help");
      return;
    }

    // Display accounts
    console.log("Email".padEnd(40) + "Health".padEnd(12) + "Session".padEnd(22) + "Created");
    console.log("-".repeat(95));

    for (const email of emails) {
      const info = response[email];
      const emailCol = email.padEnd(40);
      const healthCol = info.health.padEnd(12);
      const created = info.created ? new Date(info.created).toLocaleDateString() : "--";
      const sessionCol = formatSessionColumn(info.sessionData?.expires);

      console.log(`${emailCol}${healthCol}${sessionCol.padEnd(22)}${created}`);
    }

    console.log();
  } catch (error) {
    console.error("Failed to list accounts:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Add a new account to useapi.net using cookies
 * @param client - UseApiClient instance
 * @param cookiesPath - Path to the cookies file
 * @param dryRun - If true, validate the cookies without actually registering
 */
export async function addAccount(client: UseApiClient, cookiesPath: string, dryRun: boolean = false): Promise<void> {
  if (dryRun) {
    console.log("\n=== Add Account to useapi.net (DRY RUN) ===\n");
  } else {
    console.log("\n=== Add Account to useapi.net ===\n");
  }

  try {
    console.log(`Cookies file: ${cookiesPath}`);
    if (dryRun) {
      console.log("Mode: Validation only (dry-run)\n");
    }

    const result = await client.addAccount(cookiesPath, dryRun);

    if (result.success) {
      if (dryRun) {
        console.log("✓ Cookies validated successfully!");
        console.log("  Run without --dry-run to register the account.");
      } else {
        console.log("✓ Account added successfully!");
      }
      if (result.message) {
        console.log(`  ${result.message}`);
      }
    } else {
      console.log("✗ Failed to add account");
      if (result.message) {
        console.log(`  ${result.message}`);
      }
    }
    console.log();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(errMsg);
    console.log();
  }
}

/**
 * Configure CAPTCHA provider for all accounts
 * POST /google-flow/accounts/captcha-providers
 *
 * @param client - UseApiClient instance
 * @param provider - Provider name: "EzCaptcha", "CapSolver", or "YesCaptcha"
 * @param apiKey - API key for the provider, or "" to remove
 */
export async function configureCaptcha(
  client: UseApiClient,
  provider: string,
  apiKey: string
): Promise<void> {
  console.log("\n=== Configure CAPTCHA Provider ===\n");

  // Normalize provider name to API format (case-insensitive input)
  const providerMap: Record<string, "EzCaptcha" | "CapSolver" | "YesCaptcha"> = {
    "ezcaptcha": "EzCaptcha",
    "capsolver": "CapSolver",
    "yescaptcha": "YesCaptcha",
    // Also accept exact names
    "EzCaptcha": "EzCaptcha",
    "CapSolver": "CapSolver",
    "YesCaptcha": "YesCaptcha",
  };

  const normalizedProvider = providerMap[provider.toLowerCase()] || providerMap[provider];

  if (!normalizedProvider) {
    console.error(`Invalid provider: ${provider}`);
    console.log(`Valid providers: EzCaptcha, CapSolver, YesCaptcha`);
    return;
  }

  try {
    const config: UseApiCaptchaConfig = {
      provider: normalizedProvider,
      apiKey,
    };

    const result = await client.configureCaptcha(config);

    // Show configured providers
    console.log(`✓ CAPTCHA provider "${normalizedProvider}" ${apiKey === "" ? "removed" : "configured"}`);

    // Show all providers status
    if (result.freeCaptchaCredits !== undefined) {
      console.log(`  Free credits remaining: ${result.freeCaptchaCredits}`);
    }

    const configuredProviders = [
      result.EzCaptcha ? "EzCaptcha" : null,
      result.CapSolver ? "CapSolver" : null,
      result.YesCaptcha ? "YesCaptcha" : null,
    ].filter(Boolean);

    if (configuredProviders.length > 0) {
      console.log(`  Configured providers: ${configuredProviders.join(", ")}`);
    }
  } catch (error) {
    console.error("Failed to configure CAPTCHA:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * List configured CAPTCHA providers
 * GET /google-flow/accounts/captcha-providers
 */
export async function listCaptchaProviders(client: UseApiClient): Promise<void> {
  console.log("\n=== CAPTCHA Providers ===\n");

  try {
    const response = await client.getCaptchaProviders();

    // Check if there are free credits
    if (response.freeCaptchaCredits !== undefined) {
      console.log(`Free CAPTCHA Credits: ${response.freeCaptchaCredits} remaining`);
      console.log();
    }

    // Build list of configured providers
    const configuredProviders: Array<{ name: string; key: string }> = [];
    if (response.EzCaptcha) configuredProviders.push({ name: "EzCaptcha", key: response.EzCaptcha });
    if (response.CapSolver) configuredProviders.push({ name: "CapSolver", key: response.CapSolver });
    if (response.YesCaptcha) configuredProviders.push({ name: "YesCaptcha", key: response.YesCaptcha });

    if (configuredProviders.length === 0 && response.freeCaptchaCredits === undefined) {
      console.log("No CAPTCHA providers configured and no free credits.");
      console.log("\nTo configure a provider:");
      console.log("  bun run flow.ts useapi:captcha --provider capsolver --key YOUR_API_KEY");
      console.log("\nSupported providers:");
      console.log("  - EzCaptcha  (~$2.50/1000, recommended)");
      console.log("  - CapSolver  (~$3.00/1000)");
      console.log("  - YesCaptcha (varies)");
      return;
    }

    if (configuredProviders.length > 0) {
      console.log("Provider".padEnd(15) + "Status".padEnd(12) + "API Key (masked)");
      console.log("-".repeat(60));

      for (const { name, key } of configuredProviders) {
        console.log(`${name.padEnd(15)}${"✓ Active".padEnd(12)}${key}`);
      }
    }

    // Show free credits status note
    if (response.freeCaptchaCredits !== undefined) {
      if (response.freeCaptchaCredits === 0) {
        console.log("\nNote: Free credits exhausted. CAPTCHA solving uses configured provider(s) above.");
      } else {
        console.log(`\nNote: ${response.freeCaptchaCredits} free credits remaining. These are used before paid providers.`);
      }
    }

    console.log();
  } catch (error) {
    console.error("Failed to list CAPTCHA providers:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Show detailed health information for an account
 */
export async function showHealth(client: UseApiClient, email: string): Promise<void> {
  console.log("\n=== useapi.net Health Check ===\n");

  try {
    const health = await client.getAccountHealth(email);

    console.log(`Account: ${email}`);
    console.log(`Status: ${health.status}`);
    console.log(`Tier: ${health.tier}`);

    if (health.captchaCredits !== undefined) {
      console.log(`CAPTCHA Credits: ${health.captchaCredits}`);
    }

    if (health.message) {
      console.log(`Message: ${health.message}`);
    }

    // Session status
    try {
      const session = await client.getSessionStatus(email);
      console.log(formatSessionStatusLine(session));
      if (session.nextRefresh) {
        console.log(`Next auto-refresh: ${new Date(session.nextRefresh).toLocaleString()}`);
      }
    } catch {
      console.log("Session: -- Unable to check session status");
    }

    // Show overall health status
    console.log();
    if (health.status === "active" || health.status === "ok") {
      console.log("✓ Account is healthy and ready for video generation");
    } else {
      console.log("⚠ Account may have issues. Check the status above.");
    }
  } catch (error) {
    console.error("Health check failed:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Run health check with history stats
 */
export async function runFullHealthCheck(
  client: UseApiClient,
  email: string,
  getRecentStats?: () => { success: number; failed: number; rateLimited: number } | Promise<{ success: number; failed: number; rateLimited: number }>
): Promise<void> {
  console.log("\n=== useapi.net Full Health Check ===\n");

  try {
    // API health
    console.log("API Status:");
    const health = await client.getAccountHealth(email);

    console.log(`├── Status: ${health.status === "active" || health.status === "ok" ? "✓ Online" : `⚠ ${health.status}`}`);
    console.log(`├── Account: ${email}`);
    console.log(`│   ├── Tier: ${health.tier}`);
    console.log(`│   └── Health: ${health.status}`);

    // Session status
    try {
      const session = await client.getSessionStatus(email);
      console.log(`├── ${formatSessionStatusLine(session)}`);
      if (session.nextRefresh) {
        console.log(`│   └── Next auto-refresh: ${new Date(session.nextRefresh).toLocaleString()}`);
      }
    } catch {
      console.log(`├── Session: -- Unable to check session status`);
    }

    if (health.captchaCredits !== undefined && health.captchaCredits > 0) {
      console.log(`└── CAPTCHA: ${health.captchaCredits} free credits remaining`);
    } else {
      // Check for configured paid providers
      try {
        const captchaResponse = await client.getCaptchaProviders();
        const providers: string[] = [];
        if (captchaResponse.CapSolver) providers.push("CapSolver");
        if (captchaResponse.EzCaptcha) providers.push("EzCaptcha");
        if (captchaResponse.YesCaptcha) providers.push("YesCaptcha");

        if (providers.length > 0) {
          console.log(`└── CAPTCHA: ✓ ${providers.join(", ")} configured (free credits exhausted)`);
        } else {
          console.log(`└── CAPTCHA: ⚠ No provider configured and no free credits`);
        }
      } catch {
        console.log(`└── CAPTCHA: Unable to check provider status`);
      }
    }

    // Recent history stats
    if (getRecentStats) {
      const stats = await Promise.resolve(getRecentStats());
      const total = stats.success + stats.failed + stats.rateLimited;

      console.log();
      console.log("Recent History (last 24h):");
      if (total > 0) {
        const successRate = Math.round((stats.success / total) * 100);
        console.log(`├── Success: ${stats.success} (${successRate}%)`);
        console.log(`├── Failed: ${stats.failed}`);
        console.log(`└── Rate Limited: ${stats.rateLimited}`);
      } else {
        console.log("└── No recent activity");
      }
    }

    console.log();
  } catch (error) {
    console.error("Health check failed:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Print step-by-step instructions for exporting Google cookies
 */
export function showCookieExportGuide(): void {
  console.log("\n=== How to Export Google Cookies for useapi.net ===\n");
  console.log("Method 1: Puppeteer Script (Recommended)");
  console.log("  bun run scripts/get-google-cookies.ts");
  console.log("  bun run flow.ts useapi:accounts add --cookies ./google-account-cookies.json\n");
  console.log("Method 2: Chrome DevTools (Manual)");
  console.log("  1. Open Chrome and go to https://myaccount.google.com");
  console.log("  2. Open DevTools (F12 or Cmd+Option+I)");
  console.log("  3. Go to Application tab > Cookies > accounts.google.com");
  console.log("     IMPORTANT: Must be 'accounts.google.com', NOT 'myaccount.google.com'");
  console.log("  4. Click any cookie row, then Ctrl+A (Cmd+A) to select all");
  console.log("  5. Ctrl+C (Cmd+C) to copy");
  console.log("  6. Paste into a new file: google-cookies.txt");
  console.log("  7. Run: bun run flow.ts useapi:accounts add --cookies ./google-cookies.txt\n");
  console.log("Tips:");
  console.log("  - Login to https://labs.google/fx/tools/flow FIRST before exporting");
  console.log("  - During 2FA, check 'Don't ask again on this device'");
  console.log("  - Both JSON and tab-separated formats are supported");
  console.log("  - Use --dry-run to validate cookies without registering\n");
}
