import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * BrowserManager owns the lifecycle state machine (CAPTCHA streak -> restart,
 * idle close, headless switching, launch serialization). None of that needs a
 * real Chrome, so patchright is mocked and every branch is exercised directly.
 */

const launchCalls: any[] = [];
let contexts: FakeContext[] = [];

class FakePage {
  closed = false;
  private handlers: Record<string, (() => void)[]> = {};
  once(event: string, cb: () => void) {
    (this.handlers[event] ||= []).push(cb);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.handlers["close"] || []) cb();
  }
}

class FakeContext {
  closed = false;
  pages: FakePage[] = [];
  constructor(public opts: any) {}
  async cookies() {
    if (this.closed) throw new Error("Target page, context or browser has been closed");
    return [];
  }
  async newPage() {
    const p = new FakePage();
    this.pages.push(p);
    return p;
  }
  browser() {
    return { version: () => "HeadlessChrome/140.1.2.3" };
  }
  async close() {
    this.closed = true;
    for (const p of this.pages) await p.close();
  }
}

vi.mock("patchright", () => ({
  chromium: {
    launchPersistentContext: vi.fn(async (_dir: string, opts: any) => {
      launchCalls.push(opts);
      const ctx = new FakeContext(opts);
      contexts.push(ctx);
      return ctx;
    }),
  },
}));

async function freshManager(env: Record<string, string> = {}) {
  vi.resetModules();
  launchCalls.length = 0;
  contexts = [];
  Object.assign(process.env, env);
  const { BrowserManager } = await import("../src/browser/browser-manager.js");
  return new BrowserManager();
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
});

describe("CAPTCHA streak handling", () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_CAPTCHA_MAX_CONSECUTIVE = "3";
    process.env.GOOGLE_AI_CAPTCHA_COOLDOWN_MS = "0";
  });

  it("asks for a restart only once the limit is reached", async () => {
    const mgr = await freshManager();
    expect(mgr.recordCaptcha()).toBe(false);
    expect(mgr.recordCaptcha()).toBe(false);
    expect(mgr.recordCaptcha()).toBe(true);
  });

  it("resets the streak after a restart, so the next CAPTCHA is solvable", async () => {
    // Regression: the counter used to survive the restart, so every later
    // CAPTCHA re-triggered a restart and the visible browser (the only way a
    // human can solve one) was never opened again.
    const mgr = await freshManager();
    mgr.recordCaptcha();
    mgr.recordCaptcha();
    expect(mgr.recordCaptcha()).toBe(true);

    await mgr.restartBrowser("max consecutive CAPTCHAs");

    expect(mgr.recordCaptcha()).toBe(false);
    expect(mgr.recordCaptcha()).toBe(false);
    expect(mgr.recordCaptcha()).toBe(true);
  });

  it("resets the streak on a successful search", async () => {
    const mgr = await freshManager();
    mgr.recordCaptcha();
    mgr.recordCaptcha();
    mgr.resetCaptchaCounter();
    expect(mgr.recordCaptcha()).toBe(false);
  });
});

describe("context lifecycle", () => {
  it("reuses a live context instead of relaunching", async () => {
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
    await mgr.getOrCreateContext(true);
    const launchesAfterFirst = launchCalls.length;
    await mgr.getOrCreateContext(true);
    expect(launchCalls.length).toBe(launchesAfterFirst);
  });

  it("recreates when the context died underneath it", async () => {
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
    await mgr.getOrCreateContext(true);
    const before = launchCalls.length;

    contexts.at(-1)!.closed = true; // simulate Chrome crash
    await mgr.getOrCreateContext(true);

    expect(launchCalls.length).toBe(before + 1);
  });

  it("recreates when headless mode changes", async () => {
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
    await mgr.getOrCreateContext(true);
    expect(mgr.isHeadless()).toBe(true);
    const before = launchCalls.length;

    await mgr.switchToVisibleMode();

    expect(launchCalls.length).toBeGreaterThan(before);
    expect(mgr.isHeadless()).toBe(false);
    expect(launchCalls.at(-1).headless).toBe(false);
  });

  it("serializes concurrent acquisitions onto one launch (profile-lock race)", async () => {
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });

    const [a, b, c] = await Promise.all([
      mgr.getOrCreateContext(true),
      mgr.getOrCreateContext(true),
      mgr.getOrCreateContext(true),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    // One UA probe launch + one real launch. Two concurrent callers must not
    // produce two real contexts on the same profile dir.
    expect(contexts.filter((ctx) => !ctx.closed).length).toBe(1);
  });

  it("closeContext is idempotent when nothing is open", async () => {
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
    await expect(mgr.closeContext()).resolves.toBeUndefined();
  });
});

describe("idle close", () => {
  it("closes the browser after the idle window with no pages open", async () => {
    vi.useFakeTimers();
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "1000" });
    await mgr.getOrCreateContext(true);
    const ctx = contexts.at(-1)!;

    const page = await mgr.createPage();
    await page.close();
    await vi.advanceTimersByTimeAsync(1500);

    expect(ctx.closed).toBe(true);
  });

  it("never closes the browser while a page is still open", async () => {
    // A CAPTCHA wait can legitimately hold a page for minutes.
    vi.useFakeTimers();
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "1000" });
    await mgr.getOrCreateContext(true);
    const ctx = contexts.at(-1)!;

    await mgr.createPage();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(ctx.closed).toBe(false);
  });

  it("re-acquiring cancels a pending idle close", async () => {
    vi.useFakeTimers();
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "1000" });
    await mgr.getOrCreateContext(true);
    const ctx = contexts.at(-1)!;

    const p1 = await mgr.createPage();
    await p1.close();
    await vi.advanceTimersByTimeAsync(600); // idle timer armed, not yet fired
    await mgr.createPage();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(ctx.closed).toBe(false);
  });

  it("stays open forever when the idle timeout is disabled", async () => {
    vi.useFakeTimers();
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
    await mgr.getOrCreateContext(true);
    const ctx = contexts.at(-1)!;

    const page = await mgr.createPage();
    await page.close();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(ctx.closed).toBe(false);
  });
});

describe("stealth user agent", () => {
  it("derives the UA from the installed Chrome version on Linux", async () => {
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    try {
      const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
      await mgr.getOrCreateContext(true);
      expect(launchCalls.at(-1).userAgent).toContain("Chrome/140.1.2.3");
      // Never leak the headless marker Chrome reports in its version string.
      expect(launchCalls.at(-1).userAgent).not.toContain("Headless");
    } finally {
      spy.mockRestore();
    }
  });

  it("sends no UA override on non-Linux, where the Linux string would be a lie", async () => {
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    try {
      const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "0" });
      await mgr.getOrCreateContext(true);
      expect(launchCalls.at(-1).userAgent).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("createPage", () => {
  it("releases the page reservation when creation fails", async () => {
    vi.useFakeTimers();
    const mgr = await freshManager({ GOOGLE_AI_IDLE_TIMEOUT_MS: "1000" });
    await mgr.getOrCreateContext(true);
    const ctx = contexts.at(-1)!;
    ctx.newPage = async () => {
      throw new Error("page creation failed");
    };

    await expect(mgr.createPage()).rejects.toThrow("page creation failed");
    // Reservation released => idle close can still fire; a leaked count would
    // pin Chrome forever.
    await vi.advanceTimersByTimeAsync(1500);
    expect(ctx.closed).toBe(true);
  });
});
