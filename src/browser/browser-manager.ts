/**
 * Browser Manager for Google AI Search Mode
 *
 * Manages a single persistent browser context for all searches.
 * Simplified version - no authentication, no session pooling.
 */

import type { BrowserContext, Page } from "patchright";
import { chromium } from "patchright";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

// Browser arguments for stealth mode
const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
  "--disable-notifications",
  "--disable-popup-blocking",
  "--lang=en-US", // Set browser language to English
];

export class BrowserManager {
  private context: BrowserContext | null = null;
  private currentHeadlessMode: boolean | null = null;
  private consecutiveCaptchas: number = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private openPages = 0;
  // Serializes launch/recreate so concurrent search_ai calls can't both
  // launchPersistentContext on the same profile dir (Chrome profile lock).
  private launchChain: Promise<unknown> = Promise.resolve();
  // Detected once (cached) so the UA always matches the installed Chrome version.
  private static cachedUserAgent: string | null = null;

  constructor() {
    log.info("🌐 BrowserManager initialized");
    log.info(`  Chrome Profile: ${CONFIG.browserProfileDir}`);
  }

  /**
   * Get or create the browser context
   */
  /**
   * Serialize every context lifecycle mutation (create/close/recreate) onto a
   * single promise chain so an idle close, a CAPTCHA restart, and a new search
   * can never run `launchPersistentContext`/`context.close()` against the same
   * profile dir concurrently (Chrome profile-lock race).
   */
  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.launchChain.then(op);
    // Chain stays healthy even when an op fails; the awaiting caller gets the error.
    this.launchChain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  async getOrCreateContext(headless?: boolean): Promise<BrowserContext> {
    await this.serialize(async () => {
      // Acquiring the context for use - cancel any pending idle close so it
      // can't fire mid-search (openPages re-arms it once pages hit zero).
      this.clearIdleTimer();

      // Check if headless mode needs to be changed
      if (this.needsHeadlessModeChange(headless)) {
        log.warning("🔄 Headless mode change - recreating context...");
        await this.closeContext();
      }

      // Check if context needs recreation
      if (await this.needsRecreation()) {
        await this.recreateContext(headless);
      } else {
        log.success("♻️  Reusing existing context");
      }
    });
    return this.context!;
  }

  /**
   * Close the browser after a period of inactivity so an idle MCP server
   * doesn't pin a full Chrome tree for hours (next search relaunches it).
   * Only armed while no pages are open, so a long search (e.g. CAPTCHA wait)
   * can never be killed mid-flight.
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    if (CONFIG.idleTimeoutMs <= 0 || !this.context || this.openPages > 0) return;
    this.idleTimer = setTimeout(() => {
      // Route the close through the same serialization chain and re-check that
      // no page was acquired between the timer firing and the op running.
      this.serialize(async () => {
        if (this.openPages > 0 || !this.context) return;
        log.info(`⏳ No activity for ${CONFIG.idleTimeoutMs}ms - closing idle browser`);
        await this.closeContext();
      }).catch((e) => log.warning(`Idle close failed: ${e}`));
    }, CONFIG.idleTimeoutMs);
  }

  /**
   * Check if headless mode needs to change
   */
  private needsHeadlessModeChange(headless?: boolean): boolean {
    if (headless === undefined || this.currentHeadlessMode === null) {
      return false;
    }
    return this.currentHeadlessMode !== headless;
  }

  /**
   * Check if context needs recreation
   */
  private async needsRecreation(): Promise<boolean> {
    if (!this.context) {
      return true;
    }

    try {
      await this.context.cookies();
      return false;
    } catch (error) {
      log.warning("  ⚠️  Context closed - will recreate");
      this.context = null;
      this.currentHeadlessMode = null;
      return true;
    }
  }

  /**
   * Create or recreate the browser context
   */
  private async recreateContext(headless?: boolean): Promise<void> {
    // Close old context if exists
    if (this.context) {
      try {
        await this.context.close();
      } catch (error) {
        log.warning(`Error closing context: ${error}`);
      }
    }

    // Determine headless mode
    const shouldBeHeadless = headless !== undefined ? headless : CONFIG.headless;

    // Platform-aware DISPLAY check (Linux only)
    // Windows/Mac have native display servers and don't need DISPLAY variable
    if (!shouldBeHeadless && process.platform === 'linux' && !process.env.DISPLAY) {
      throw new Error(`❌ Cannot start visible browser: No X-Server detected ($DISPLAY not set)

This commonly occurs in:
- Codex AI editor (Linux/WSL)
- Docker containers
- SSH sessions without X11 forwarding

Solution for Codex (Linux/WSL):
Add xvfb-run wrapper in your MCP config:

{
  "mcpServers": {
    "google-ai-search": {
      "command": "xvfb-run",
      "args": ["-a", "npx", "google-ai-mode-mcp@latest"]
    }
  }
}

Install xvfb if needed: sudo apt-get install xvfb

Alternative: Use headless mode (set headless: true in tool parameters)`);
    }

    this.currentHeadlessMode = shouldBeHeadless;

    log.info(`  🚀 Launching browser (${shouldBeHeadless ? "headless" : "visible"})`);

    try {
      // UA is context-level in patchright (no per-page setter), so it must be
      // known at launch. We derive it from the *actually installed* Chrome
      // version (cached after first detection) so it never drifts from
      // navigator.platform / buildID - a hardcoded UA would reintroduce the
      // detectable bot tell this PR fixes.
      const userAgent = await this.resolveUserAgent(shouldBeHeadless);

      this.context = await chromium.launchPersistentContext(
        CONFIG.browserProfileDir,
        {
          channel: "chrome",
          headless: shouldBeHeadless,
          // NO viewport setting - use browser default (like Python skill!)
          ignoreDefaultArgs: ["--enable-automation"],
          args: BROWSER_ARGS,
          ...(userAgent ? { userAgent } : {}),
          // Set browser locale to English
          locale: "en-US",
          // Set Accept-Language header to English
          extraHTTPHeaders: {
            "Accept-Language": "en-US,en;q=0.9",
          },
        }
      );

      log.success("✅ Browser context created");
      if (userAgent) {
        log.info(`  🕵️  Stealth UA: ${userAgent}`);
      }
      // No pages open yet - arm the idle close.
      this.startIdleTimer();
    } catch (error) {
      log.error(`Failed to create browser context: ${error}`);
      throw error;
    }
  }

  /**
   * Resolve a Linux Chrome user agent that matches the installed browser version.
   * The version is probed once from a throwaway launch and cached for the
   * process lifetime (the binary can't change between launches).
   */
  private async resolveUserAgent(headless: boolean): Promise<string | null> {
    if (BrowserManager.cachedUserAgent !== null) {
      return BrowserManager.cachedUserAgent;
    }

    let version = "131.0.0.0"; // safe fallback if probing fails
    let probe: BrowserContext | null = null;
    try {
      probe = await chromium.launchPersistentContext(
        CONFIG.browserProfileDir,
        {
          channel: "chrome",
          headless,
          ignoreDefaultArgs: ["--enable-automation"],
          args: BROWSER_ARGS,
        }
      );
      const browser = probe.browser();
      const rawVersion = browser ? await browser.version() : "";
      const match = rawVersion.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        version = match[1];
      }
    } catch (error) {
      log.warning(
        `⚠️  Could not probe Chrome version, using fallback UA: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      if (probe) {
        await probe.close().catch(() => {});
      }
    }

    const ua =
      `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    BrowserManager.cachedUserAgent = ua;
    return ua;
  }

  /**
   * Close the browser context
   */
  async closeContext(): Promise<void> {
    this.clearIdleTimer();
    if (this.context) {
      try {
        log.info("🗑️  Closing browser context...");
        await this.context.close();
        this.context = null;
        this.currentHeadlessMode = null;
        log.success("✅ Browser context closed");
      } catch (error) {
        log.error(`Error closing context: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Switch to visible mode (for CAPTCHA solving)
   */
  async switchToVisibleMode(): Promise<void> {
    if (this.currentHeadlessMode === false) {
      log.info("Already in visible mode");
      return;
    }

    log.info("👁️  Switching to VISIBLE mode for CAPTCHA...");
    await this.getOrCreateContext(false); // headless=false
  }

  /**
   * Switch to headless mode
   */
  async switchToHeadlessMode(): Promise<void> {
    if (this.currentHeadlessMode === true) {
      log.info("Already in headless mode");
      return;
    }

    log.info("🔒 Switching to HEADLESS mode...");
    await this.getOrCreateContext(true); // headless=true
  }

  /**
   * Restart browser with fresh profile (for consecutive CAPTCHAs)
   */
  async restartBrowser(reason: string): Promise<void> {
    log.warning(`🔄 Restarting browser (${reason})...`);

    // One serialized op so a concurrent search can't launch on the profile
    // dir while this close/recreate cycle is mid-flight.
    await this.serialize(async () => {
      await this.closeContext();

      // Wait for cooldown
      log.info(`⏸️  Cooldown: ${CONFIG.captchaCooldownMs}ms...`);
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.captchaCooldownMs)
      );

      // Recreate with random viewport
      await this.recreateContext();
    });

    log.success("✅ Browser restarted");
  }

  /**
   * Record CAPTCHA occurrence and check if browser restart is needed
   */
  recordCaptcha(): boolean {
    this.consecutiveCaptchas++;
    log.warning(`⚠️  Consecutive CAPTCHAs: ${this.consecutiveCaptchas}`);

    if (this.consecutiveCaptchas >= CONFIG.captchaMaxConsecutive) {
      log.warning("🚨 Max consecutive CAPTCHAs reached - browser restart needed");
      return true;
    }

    return false;
  }

  /**
   * Reset consecutive CAPTCHA counter (after successful search)
   */
  resetCaptchaCounter(): void {
    if (this.consecutiveCaptchas > 0) {
      log.success(`✅ Resetting CAPTCHA counter (was ${this.consecutiveCaptchas})`);
      this.consecutiveCaptchas = 0;
    }
  }

  /**
   * Create a new page in the current context.
   * The stealth user agent is inherited from the context (set at launch).
   */
  async createPage(): Promise<Page> {
    // Reserve the page slot BEFORE any await so an idle timer that fires while
    // the context/page is being created sees openPages > 0 and won't close it.
    this.openPages++;
    this.clearIdleTimer();
    try {
      const context = await this.getOrCreateContext();
      const page = await context.newPage();
      page.once("close", () => {
        this.openPages--;
        this.startIdleTimer();
      });
      return page;
    } catch (error) {
      // Creation failed - release the reservation and re-arm the idle timer.
      this.openPages--;
      this.startIdleTimer();
      throw error;
    }
  }

  /**
   * Get current headless mode
   */
  isHeadless(): boolean {
    return this.currentHeadlessMode === true;
  }
}
