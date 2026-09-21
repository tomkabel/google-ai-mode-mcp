import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Since CONFIG is computed at import time from env vars, we test the
// parsing functions and the applyBrowserOptions helper. For env-var
// override tests we use vi.resetModules() + dynamic import to re-evaluate
// the module with new env values.

describe("CONFIG defaults", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Clean up any env vars we set
    delete process.env.GOOGLE_AI_HEADLESS;
    delete process.env.GOOGLE_AI_BROWSER_TIMEOUT;
    delete process.env.GOOGLE_AI_STEALTH_ENABLED;
    delete process.env.GOOGLE_AI_PROFILE_DIR;
    delete process.env.GOOGLE_AI_TYPING_WPM_MIN;
    delete process.env.GOOGLE_AI_TYPING_WPM_MAX;
    delete process.env.GOOGLE_AI_MIN_DELAY_MS;
    delete process.env.GOOGLE_AI_MAX_DELAY_MS;
  });

  it("has sensible default values", async () => {
    const mod = await import("../src/config.js");
    const config = mod.CONFIG;

    expect(config.headless).toBe(true);
    expect(config.browserTimeout).toBe(30000);
    expect(config.stealthEnabled).toBe(true);
    expect(config.captchaTimeout).toBe(300000);
    expect(config.captchaPollInterval).toBe(3000);
    expect(config.captchaMaxConsecutive).toBe(3);
    expect(config.responseTimeout).toBe(30000);
    expect(config.citationTimeout).toBe(5000);
    expect(config.idleTimeoutMs).toBe(600000);
    expect(config.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it("applies GOOGLE_AI_HEADLESS=false", async () => {
    process.env.GOOGLE_AI_HEADLESS = "false";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.headless).toBe(false);
  });

  it("applies GOOGLE_AI_BROWSER_TIMEOUT override", async () => {
    process.env.GOOGLE_AI_BROWSER_TIMEOUT = "60000";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.browserTimeout).toBe(60000);
  });

  it("ignores non-integer env values", async () => {
    process.env.GOOGLE_AI_BROWSER_TIMEOUT = "notanumber";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.browserTimeout).toBe(30000);
  });

  it("parses 1 as true for booleans", async () => {
    process.env.GOOGLE_AI_STEALTH_ENABLED = "1";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.stealthEnabled).toBe(true);
  });

  it("parses 0 as false for booleans", async () => {
    process.env.GOOGLE_AI_STEALTH_ENABLED = "0";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.stealthEnabled).toBe(false);
  });

  it("falls back to default for invalid boolean", async () => {
    process.env.GOOGLE_AI_HEADLESS = "maybe";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.headless).toBe(true); // default
  });

  it("respects GOOGLE_AI_PROFILE_DIR override", async () => {
    process.env.GOOGLE_AI_PROFILE_DIR = "/tmp/google-ai-mcp-test-profile";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.browserProfileDir).toBe("/tmp/google-ai-mcp-test-profile");
  });

  it("applies typing WPM overrides", async () => {
    process.env.GOOGLE_AI_TYPING_WPM_MIN = "100";
    process.env.GOOGLE_AI_TYPING_WPM_MAX = "200";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.typingWpmMin).toBe(100);
    expect(mod.CONFIG.typingWpmMax).toBe(200);
  });

  it("applies delay overrides", async () => {
    process.env.GOOGLE_AI_MIN_DELAY_MS = "50";
    process.env.GOOGLE_AI_MAX_DELAY_MS = "200";
    const mod = await import("../src/config.js");
    expect(mod.CONFIG.minDelayMs).toBe(50);
    expect(mod.CONFIG.maxDelayMs).toBe(200);
  });
});

describe("applyBrowserOptions", () => {
  it("returns a copy of CONFIG when no options", async () => {
    const mod = await import("../src/config.js");
    const config = mod.applyBrowserOptions(undefined);
    expect(config.headless).toBe(mod.CONFIG.headless);
    expect(config.browserTimeout).toBe(mod.CONFIG.browserTimeout);
    // Should be a different object (not mutated)
    expect(config).not.toBe(mod.CONFIG);
  });

  it("applies headless override", async () => {
    const mod = await import("../src/config.js");
    const config = mod.applyBrowserOptions({ headless: false });
    expect(config.headless).toBe(false);
  });

  it("applies timeout_ms override", async () => {
    const mod = await import("../src/config.js");
    const config = mod.applyBrowserOptions({ timeout_ms: 99999 });
    expect(config.browserTimeout).toBe(99999);
  });

  it("does not mutate global CONFIG", async () => {
    const mod = await import("../src/config.js");
    const originalTimeout = mod.CONFIG.browserTimeout;
    mod.applyBrowserOptions({ timeout_ms: 1 });
    expect(mod.CONFIG.browserTimeout).toBe(originalTimeout);
  });
});

describe("ensureDirectories", () => {
  it("creates data dir and profile dir", async () => {
    const mod = await import("../src/config.js");
    const fs = await import("fs");
    expect(fs.existsSync(mod.CONFIG.dataDir)).toBe(true);
    expect(fs.existsSync(mod.CONFIG.browserProfileDir)).toBe(true);
  });
});

describe("VIEWPORT_SIZES", () => {
  it("has multiple viewport sizes", async () => {
    const mod = await import("../src/config.js");
    expect(mod.VIEWPORT_SIZES.length).toBeGreaterThan(3);
    for (const v of mod.VIEWPORT_SIZES) {
      expect(v.width).toBeGreaterThan(0);
      expect(v.height).toBeGreaterThan(0);
    }
  });
});
