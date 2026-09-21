import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SearchHandler is pure orchestration: navigate, branch on CAPTCHA / region
 * block, extract, and close pages on every exit path. Its collaborators are
 * mocked so each branch - including the ones that only happen on a bad day -
 * is covered without a browser.
 */

const state: any = {};

class FakePage {
  closed = false;
  gotos: { url: string; opts: any }[] = [];
  constructor(public label: string) {}
  url() {
    return this.gotos.at(-1)?.url ?? "about:blank";
  }
  async goto(url: string, opts: any) {
    this.gotos.push({ url, opts });
    if (state.gotoError) throw state.gotoError;
  }
  async close() {
    this.closed = true;
  }
  context() {
    return {
      request: {
        get: vi.fn(async (url: string) => ({
          status: () => 302,
          headers: () => ({ location: "https://publisher.test/" + encodeURIComponent(url) }),
        })),
      },
    };
  }
}

vi.mock("../src/browser/browser-manager.js", () => ({
  isHeadlessBlocked: vi.fn(() => state.headlessBlocked ?? false),
  markHeadlessBlocked: vi.fn(() => (state.markedBlocked = (state.markedBlocked ?? 0) + 1)),
  BrowserManager: class {
    isHeadless = vi.fn(() => state.isHeadless ?? true);
    createPage = vi.fn(async () => {
      const p = new FakePage(`page${state.pages.length}`);
      state.pages.push(p);
      return p;
    });
    getOrCreateContext = vi.fn(async () => ({
      cookies: vi.fn(async () => state.cookies ?? [{ name: "NID" }]),
    }));
    recordCaptcha = vi.fn(() => state.needsRestart ?? false);
    resetCaptchaCounter = vi.fn(() => state.counterReset++);
    restartBrowser = vi.fn(async () => state.restarts++);
    switchToVisibleMode = vi.fn(async () => state.switchedVisible++);
    switchToHeadlessMode = vi.fn(async () => state.switchedHeadless++);
    closeContext = vi.fn(async () => {});
  },
}));

vi.mock("../src/browser/captcha-detector.js", () => ({
  CaptchaDetector: class {
    detectCaptcha = vi.fn(async () => ({ detected: !!state.captcha, reason: "URL" }));
    handleCaptcha = vi.fn(async () => {
      if (state.captchaError) throw state.captchaError;
      return true;
    });
  },
}));

vi.mock("../src/search/response-parser.js", () => ({
  ResponseParser: class {
    extractAiResponse = vi.fn(async () => {
      if (state.extractError) throw state.extractError;
      return { html: `<p>${state.html ?? "answer ".repeat(60)}</p>`, citations: state.citations ?? [] };
    });
  },
}));

vi.mock("../src/utils/completion-detector.js", () => ({
  waitForAiCompletion: vi.fn(async () => ({ success: true, method: state.completionMethod ?? "content", elapsed: 1 })),
  checkAiModeAvailability: vi.fn(async () => state.aiModeAvailable ?? true),
}));

let SearchHandler: any;
let CaptchaTimeoutError: any;

beforeEach(async () => {
  Object.assign(state, {
    pages: [],
    restarts: 0,
    switchedVisible: 0,
    switchedHeadless: 0,
    counterReset: 0,
    captcha: false,
    needsRestart: false,
    aiModeAvailable: true,
    cookies: [{ name: "NID" }],
    gotoError: undefined,
    extractError: undefined,
    captchaError: undefined,
    citations: [],
    html: undefined,
    completionMethod: "content",
    headlessBlocked: false,
    markedBlocked: 0,
    isHeadless: true,
  });
  vi.resetModules();
  ({ SearchHandler } = await import("../src/search/search-handler.js"));
  ({ CaptchaTimeoutError } = await import("../src/errors.js"));
});

afterEach(() => vi.restoreAllMocks());

describe("happy path", () => {
  it("navigates to the AI Mode URL and returns markdown", async () => {
    const result = await new SearchHandler().executeSearch("quantum tunneling");

    expect(result.success).toBe(true);
    expect(result.query).toBe("quantum tunneling");
    expect(state.pages[0].gotos[0].url).toBe(
      "https://www.google.com/search?udm=50&q=quantum%20tunneling"
    );
    expect(state.counterReset).toBe(1);
  });

  it("percent-encodes queries so operators can't break the URL", async () => {
    await new SearchHandler().executeSearch('site:example.com "a&b" #1');
    const url = state.pages[0].gotos[0].url;
    expect(url).not.toMatch(/[ "#]/);
    expect(url).toContain("%22a%26b%22");
  });

  it("closes the page on success (no leaked tabs)", async () => {
    await new SearchHandler().executeSearch("q");
    expect(state.pages.every((p: FakePage) => p.closed)).toBe(true);
  });

  it("honours the per-call timeout_ms instead of the global default", async () => {
    // Regression: navigation used the global CONFIG value, so the documented
    // tool parameter silently did nothing.
    await new SearchHandler().executeSearch("q", { timeout_ms: 4321 });
    expect(state.pages[0].gotos[0].opts.timeout).toBe(4321);
  });
});

describe("cold profile warm-up", () => {
  it("lands on the homepage first when there are no cookies", async () => {
    state.cookies = [];
    await new SearchHandler().executeSearch("q");
    expect(state.pages[0].gotos[0].url).toBe("https://www.google.com");
    expect(state.pages[0].gotos[1].url).toContain("udm=50");
  });

  it("skips the warm-up for a warm profile", async () => {
    await new SearchHandler().executeSearch("q");
    expect(state.pages[0].gotos).toHaveLength(1);
  });

  it("continues the search when the warm-up navigation fails", async () => {
    state.cookies = [];
    state.gotoError = undefined;
    const handler = new SearchHandler();
    // Fail only the first goto (the warm-up).
    let first = true;
    const origCreate = handler["browserManager"].createPage;
    handler["browserManager"].createPage = async () => {
      const p = await origCreate();
      const goto = p.goto.bind(p);
      p.goto = async (url: string, opts: any) => {
        if (first) {
          first = false;
          throw new Error("net::ERR_TIMED_OUT");
        }
        return goto(url, opts);
      };
      return p;
    };

    const result = await handler.executeSearch("q");

    expect(result.success).toBe(true);
  });
});

describe("CAPTCHA branch", () => {
  it("switches to a visible browser, solves, stays visible and flags headless as blocked", async () => {
    state.captcha = true;
    const result = await new SearchHandler().executeSearch("q");

    expect(state.switchedVisible).toBe(1);
    expect(state.switchedHeadless).toBe(0);
    expect(state.markedBlocked).toBe(1);
    expect(result.success).toBe(true);
    expect(state.pages.every((p: FakePage) => p.closed)).toBe(true);
  });

  it("does not flag headless when the CAPTCHA hit a visible browser", async () => {
    state.captcha = true;
    state.isHeadless = false;
    await new SearchHandler().executeSearch("q");
    expect(state.markedBlocked).toBe(0);
  });

  it("goes straight to visible when the headless-blocked flag is set", async () => {
    state.headlessBlocked = true;
    const handler = new SearchHandler();
    await handler.executeSearch("q");
    expect(handler["browserManager"].getOrCreateContext).toHaveBeenCalledWith(false);
  });

  it("explicit headless:true option overrides the blocked flag", async () => {
    state.headlessBlocked = true;
    const handler = new SearchHandler();
    await handler.executeSearch("q", { headless: true });
    expect(handler["browserManager"].getOrCreateContext).toHaveBeenCalledWith(true);
  });

  it("restarts the browser and reports failure on a CAPTCHA streak", async () => {
    state.captcha = true;
    state.needsRestart = true;

    const result = await new SearchHandler().executeSearch("q");

    expect(state.restarts).toBe(1);
    expect(result.success).toBe(false);
    expect(result.captchaRequired).toBe(true);
    expect(state.switchedVisible).toBe(0);
  });

  it("reports captchaRequired (not a crash) when the solve times out", async () => {
    state.captcha = true;
    state.captchaError = new CaptchaTimeoutError("timeout");

    const result = await new SearchHandler().executeSearch("q");

    expect(result.success).toBe(false);
    expect(result.captchaRequired).toBe(true);
    expect(state.pages.every((p: FakePage) => p.closed)).toBe(true);
  });

  it("propagates non-timeout errors from the CAPTCHA flow as a failed search", async () => {
    state.captcha = true;
    state.captchaError = new Error("browser exploded");

    const result = await new SearchHandler().executeSearch("q");

    expect(result.success).toBe(false);
    expect(result.error).toContain("browser exploded");
  });
});

describe("failure paths", () => {
  it("reports the region/language block with actionable text", async () => {
    state.aiModeAvailable = false;
    const result = await new SearchHandler().executeSearch("q");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not available in your country/i);
    expect(state.pages[0].closed).toBe(true);
  });

  it("never leaks a page when extraction throws", async () => {
    state.extractError = new Error("main-col not found");
    const result = await new SearchHandler().executeSearch("q");

    expect(result.success).toBe(false);
    expect(state.pages.every((p: FakePage) => p.closed)).toBe(true);
  });

  it("returns a failed result rather than throwing when navigation fails", async () => {
    state.gotoError = new Error("net::ERR_CONNECTION_REFUSED");
    const result = await new SearchHandler().executeSearch("q");

    expect(result.success).toBe(false);
    expect(result.error).toContain("ERR_CONNECTION_REFUSED");
    expect(result.markdown).toBe("");
    expect(result.sources).toEqual([]);
  });

  it("does not reset the CAPTCHA counter on failure", async () => {
    state.extractError = new Error("boom");
    await new SearchHandler().executeSearch("q");
    expect(state.counterReset).toBe(0);
  });
});

describe("classifyResult (S1 rules)", () => {
  let classifyResult: any;
  beforeEach(async () => {
    ({ classifyResult } = await import("../src/search/search-handler.js"));
  });
  const src = { title: "T", url: "https://x.test", domain: "x.test" };
  const base = { query: "q", markdown: "a".repeat(300), sources: [src], citationCount: 1, completionMethod: "button" };

  it("ok when answer is long, sourced and completed", () => {
    const r = classifyResult(base);
    expect(r).toMatchObject({ success: true, status: "ok", warnings: [] });
  });

  it("failed + EXTRACTION_EMPTY when markdown is short", () => {
    const r = classifyResult({ ...base, markdown: "short" });
    expect(r).toMatchObject({ success: false, status: "failed", errorCode: "EXTRACTION_EMPTY", markdown: "" });
  });

  it("degraded when citations exist but no sources parsed", () => {
    const r = classifyResult({ ...base, sources: [], citationCount: 3 });
    expect(r.status).toBe("degraded");
    expect(r.warnings.join()).toMatch(/drift/);
  });

  it("degraded when completion timed out", () => {
    const r = classifyResult({ ...base, completionMethod: "timeout" });
    expect(r.status).toBe("degraded");
    expect(r.warnings.join()).toMatch(/truncated/);
  });

  it("no citations and no sources is ok, not degraded", () => {
    const r = classifyResult({ ...base, sources: [], citationCount: 0 });
    expect(r.status).toBe("ok");
  });
});

describe("empty extraction end-to-end", () => {
  it("returns failed, never success with a short answer", async () => {
    state.html = "hi";
    const result = await new SearchHandler().executeSearch("q");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("EXTRACTION_EMPTY");
  });
});

describe("resolveSourceUrls", () => {
  let resolveSourceUrls: any;
  beforeEach(async () => {
    ({ resolveSourceUrls } = await import("../src/search/search-handler.js"));
  });
  const goto = (u: string) => `https://www.google.com/goto?url=${encodeURIComponent(u)}`;

  it("replaces /goto redirects with the location header, in place", async () => {
    const sources = [
      { title: "A", url: goto("https://a.test/x"), domain: "A" },
      { title: "B", url: "https://direct.test/", domain: "B" },
    ];
    const get = vi.fn(async () => ({ status: () => 302, headers: () => ({ location: "https://a.test/x" }) }));
    await resolveSourceUrls({ get }, sources);
    expect(get).toHaveBeenCalledTimes(1);
    expect(sources[0].url).toBe("https://a.test/x");
    expect(sources[1].url).toBe("https://direct.test/");
  });

  it("keeps the redirect URL when the request fails or is not a redirect", async () => {
    const sources = [
      { title: "A", url: goto("https://a.test"), domain: "A" },
      { title: "B", url: goto("https://b.test"), domain: "B" },
    ];
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ status: () => 200, headers: () => ({}) });
    await resolveSourceUrls({ get }, sources);
    expect(sources[0].url).toBe(goto("https://a.test"));
    expect(sources[1].url).toBe(goto("https://b.test"));
  });

  it("caps concurrency at 8", async () => {
    let inFlight = 0, peak = 0;
    const get = vi.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: () => 302, headers: () => ({ location: "https://x.test/" }) };
    });
    const sources = Array.from({ length: 20 }, (_, i) => ({ title: `${i}`, url: goto(`https://s${i}.test`), domain: "" }));
    await resolveSourceUrls({ get }, sources);
    expect(peak).toBeLessThanOrEqual(8);
    expect(sources.every((s) => s.url === "https://x.test/")).toBe(true);
  });
});

describe("end-to-end URL resolution", () => {
  it("returns publisher URLs when resolve_source_urls is on and redirects when off", async () => {
    const src = () => ({ title: "T", url: "https://www.google.com/goto?url=abc", domain: "T" });
    state.html = "answer ".repeat(60) + "<code>[CITE-0]</code>";
    state.citations = [{ marker_id: 0, marker: "[CITE-0]", sources: [src()] }];
    const on = await new SearchHandler().executeSearch("q");
    expect(on.sources[0].url).toMatch(/^https:\/\/publisher\.test\//);

    state.citations = [{ marker_id: 0, marker: "[CITE-0]", sources: [src()] }];
    const off = await new SearchHandler().executeSearch("q", { resolve_source_urls: false });
    expect(off.sources[0].url).toBe("https://www.google.com/goto?url=abc");
  });
});
