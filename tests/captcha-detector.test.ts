import { describe, it, expect, beforeEach } from "vitest";

// Test the captcha detection logic without a real browser.
// We mock the Page object with just the methods CaptchaDetector uses.

describe("CaptchaDetector", () => {
  // We dynamically import to avoid pulling in patchright at module level
  // for the constructor — but actually CaptchaDetector doesn't import
  // patchright at module scope, it just uses the type. So it's safe.
  let CaptchaDetector: any;
  let detector: any;

  beforeEach(async () => {
    const mod = await import("../src/browser/captcha-detector.js");
    CaptchaDetector = mod.CaptchaDetector;
    detector = new CaptchaDetector();
  });

  function makeMockPage(url: string, text: string = "Some page content here that is long enough to pass the length check. " + "x".repeat(700)) {
    return {
      url: () => url,
      // For getPageText which calls page.textContent("body")
      textContent: async () => text,
    };
  }

  describe("isCaptchaUrl", () => {
    it("detects google.com/sorry/index URL", () => {
      const page = makeMockPage("https://www.google.com/sorry/index?continue=...");
      expect(detector.isCaptchaUrl(page)).toBe(true);
    });

    it("detects /sorry/index?continue= pattern", () => {
      const page = makeMockPage("https://www.google.com/sorry/index?continue=https://google.com");
      expect(detector.isCaptchaUrl(page)).toBe(true);
    });

    it("returns false for normal search URL", () => {
      const page = makeMockPage("https://www.google.com/search?udm=50&q=test");
      expect(detector.isCaptchaUrl(page)).toBe(false);
    });

    it("returns false for non-google URL", () => {
      const page = makeMockPage("https://example.com/search");
      expect(detector.isCaptchaUrl(page)).toBe(false);
    });
  });

  describe("detectCaptchaText", () => {
    it("detects 'unusual traffic' in English", async () => {
      const page = makeMockPage("https://google.com", "Our systems have detected unusual traffic from your network");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(true);
    });

    it("detects 'unusual traffic' partial match", async () => {
      const page = makeMockPage("https://google.com", "Some text unusual traffic more text");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(true);
    });

    it("detects German CAPTCHA text", async () => {
      const page = makeMockPage("https://google.com", "Unsere Systeme haben ungewöhnlichen Datenverkehr festgestellt");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(true);
    });

    it("detects 'CAPTCHA' keyword", async () => {
      const page = makeMockPage("https://google.com", "Please solve the CAPTCHA to continue");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(true);
    });

    it("detects 'reCAPTCHA' keyword", async () => {
      const page = makeMockPage("https://google.com", "reCAPTCHA verification needed");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(true);
    });

    it("returns false for normal text", async () => {
      const page = makeMockPage("https://google.com", "Here are your search results. The AI says hello.");
      const result = await detector.detectCaptchaText(page);
      expect(result).toBe(false);
    });
  });

  describe("detectCaptchaByLength", () => {
    it("detects suspiciously short page", async () => {
      const page = makeMockPage("https://google.com", "Short");
      const result = await detector.detectCaptchaByLength(page);
      expect(result).toBe(true);
    });

    it("returns false for normal-length page", async () => {
      const page = makeMockPage("https://google.com", "x".repeat(700));
      const result = await detector.detectCaptchaByLength(page);
      expect(result).toBe(false);
    });

    it("returns false for exactly at threshold", async () => {
      // Threshold is 600 chars; 600 chars should NOT trigger (it's < 600)
      // Actually the check is < 600, so 600 chars trimmed should be false
      const page = makeMockPage("https://google.com", "x".repeat(600));
      const result = await detector.detectCaptchaByLength(page);
      expect(result).toBe(false);
    });

    it("returns true for below threshold", async () => {
      const page = makeMockPage("https://google.com", "x".repeat(599));
      const result = await detector.detectCaptchaByLength(page);
      expect(result).toBe(true);
    });

    it("handles whitespace-only text (trimmed to 0)", async () => {
      const page = makeMockPage("https://google.com", "   \n\n  \t  ");
      const result = await detector.detectCaptchaByLength(page);
      expect(result).toBe(true);
    });
  });

  describe("detectCaptcha (comprehensive)", () => {
    it("detects CAPTCHA via URL (highest priority)", async () => {
      const page = makeMockPage("https://www.google.com/sorry/index?continue=x", "x".repeat(1000));
      const state = await detector.detectCaptcha(page);
      expect(state.detected).toBe(true);
      expect(state.reason).toBe("URL");
    });

    it("detects CAPTCHA via text when URL is clean", async () => {
      const page = makeMockPage("https://google.com/search", "unusual traffic detected. " + "x".repeat(700));
      const state = await detector.detectCaptcha(page);
      expect(state.detected).toBe(true);
      expect(state.reason).toBe("Text");
    });

    it("detects CAPTCHA via length when URL and text are clean", async () => {
      const page = makeMockPage("https://google.com/search", "short");
      const state = await detector.detectCaptcha(page);
      expect(state.detected).toBe(true);
      expect(state.reason).toBe("Length");
    });

    it("returns not detected for normal page", async () => {
      const page = makeMockPage("https://google.com/search", "x".repeat(800));
      const state = await detector.detectCaptcha(page);
      expect(state.detected).toBe(false);
    });

    it("includes URL in state", async () => {
      const page = makeMockPage("https://example.com/page", "x".repeat(800));
      const state = await detector.detectCaptcha(page);
      expect(state.url).toBe("https://example.com/page");
    });

    it("priority: URL > Text > Length", async () => {
      // URL says captcha, text says captcha, length says captcha
      // → should return URL
      const page = makeMockPage("https://google.com/sorry/index", "unusual traffic");
      const state = await detector.detectCaptcha(page);
      expect(state.reason).toBe("URL");
    });
  });

  describe("handleCaptcha", () => {
    it("returns true immediately if no CAPTCHA detected", async () => {
      const page = makeMockPage("https://google.com/search", "x".repeat(800));
      const result = await detector.handleCaptcha(page);
      expect(result).toBe(true);
    });
  });
});


