import { describe, it, expect } from "vitest";
import {
  CITATION_SELECTORS,
  AI_COMPLETION_BUTTON_ARIA,
  OVERALL_COMPLETION_TIMEOUT,
  AI_COMPLETION_TEXT_INDICATORS,
  CUTOFF_MARKERS,
  AI_MODE_NOT_AVAILABLE,
  CAPTCHA_ERROR_MESSAGES,
} from "../src/constants/language-constants.js";

describe("CITATION_SELECTORS", () => {
  it("is an array of CSS selectors", () => {
    expect(Array.isArray(CITATION_SELECTORS)).toBe(true);
    expect(CITATION_SELECTORS.length).toBeGreaterThan(5);
    for (const sel of CITATION_SELECTORS) {
      expect(typeof sel).toBe("string");
      expect(sel.length).toBeGreaterThan(0);
    }
  });

  it("includes English selectors", () => {
    expect(CITATION_SELECTORS.some((s) => s.includes("Related links"))).toBe(true);
  });

  it("includes German selectors", () => {
    expect(CITATION_SELECTORS.some((s) => s.includes("Zugehörige"))).toBe(true);
  });

  it("includes Estonian selectors", () => {
    expect(CITATION_SELECTORS.some((s) => s.includes("Seotud") || s.includes("Allikad"))).toBe(true);
  });

  it("includes case-insensitive fallback selectors", () => {
    expect(CITATION_SELECTORS.some((s) => s.includes(" i]"))).toBe(true);
  });

  it("matches the aria-label format Google actually ships", () => {
    // Captured from a live AI Mode page (2026-09). The previous Estonian entry
    // said "Seotud lingid" while the page says "Seotud tulemused", so every
    // selector missed and searches returned zero citations.
    const liveLabels = [
      "QuEra Computing (+1) – ‍What Is Quantum Tunneling? - QuEra. Seotud tulemused",
      "Wikipedia (+3) – Quantum tunnelling - Wikipedia. Related results",
    ];

    for (const label of liveLabels) {
      const matched = CITATION_SELECTORS.some((sel) => {
        const m = sel.match(/aria-label\*?=["']([^"']+)["']/);
        return m ? label.toLowerCase().includes(m[1].toLowerCase()) : false;
      });
      expect(matched, `no selector matches: ${label}`).toBe(true);
    }
  });

  it("scopes the label selectors so a citation is not counted twice", () => {
    // Google renders the same aria-label on a <button> and a sibling <a>;
    // unscoped selectors would inject two markers for one citation.
    for (const needle of ["Seotud tulemused", "Related results"]) {
      const sel = CITATION_SELECTORS.find((s) => s.includes(needle));
      expect(sel, `missing selector for ${needle}`).toBeDefined();
      expect(sel!.startsWith("button")).toBe(true);
    }
  });
});

describe("AI_COMPLETION_BUTTON_ARIA", () => {
  it("is a CSS selector string", () => {
    expect(typeof AI_COMPLETION_BUTTON_ARIA).toBe("string");
    expect(AI_COMPLETION_BUTTON_ARIA).toContain("aria-label");
  });
});

describe("Timeouts", () => {
  it("OVERALL_COMPLETION_TIMEOUT is 40000ms", () => {
    expect(OVERALL_COMPLETION_TIMEOUT).toBe(40000);
  });
});

describe("AI_COMPLETION_TEXT_INDICATORS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(AI_COMPLETION_TEXT_INDICATORS)).toBe(true);
    expect(AI_COMPLETION_TEXT_INDICATORS.length).toBeGreaterThan(3);
  });

  it("includes English indicators", () => {
    expect(AI_COMPLETION_TEXT_INDICATORS.some((s) => s.includes("AI"))).toBe(true);
  });

  it("includes German indicators", () => {
    expect(AI_COMPLETION_TEXT_INDICATORS.some((s) => s.includes("KI"))).toBe(true);
  });

  it("includes Estonian indicators", () => {
    expect(AI_COMPLETION_TEXT_INDICATORS.some((s) => s.includes("AI vastused"))).toBe(true);
  });
});

describe("CUTOFF_MARKERS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CUTOFF_MARKERS)).toBe(true);
    expect(CUTOFF_MARKERS.length).toBeGreaterThan(5);
  });

  it("includes English markers", () => {
    expect(CUTOFF_MARKERS.some((s) => s.includes("mistakes"))).toBe(true);
  });

  it("includes German markers", () => {
    expect(CUTOFF_MARKERS.some((s) => s.includes("Fehler"))).toBe(true);
  });

  it("includes Estonian markers", () => {
    expect(CUTOFF_MARKERS.some((s) => s.includes("vigu"))).toBe(true);
  });
});

describe("AI_MODE_NOT_AVAILABLE", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(AI_MODE_NOT_AVAILABLE)).toBe(true);
    expect(AI_MODE_NOT_AVAILABLE.length).toBeGreaterThan(3);
  });

  it("includes English messages", () => {
    expect(AI_MODE_NOT_AVAILABLE.some((s) => s.includes("not available"))).toBe(true);
  });

  it("includes Estonian message", () => {
    expect(AI_MODE_NOT_AVAILABLE.some((s) => s.includes("saadaval"))).toBe(true);
  });
});

describe("CAPTCHA_ERROR_MESSAGES", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CAPTCHA_ERROR_MESSAGES)).toBe(true);
    expect(CAPTCHA_ERROR_MESSAGES.length).toBeGreaterThan(3);
  });

  it("includes 'CAPTCHA' generic keyword", () => {
    expect(CAPTCHA_ERROR_MESSAGES).toContain("CAPTCHA");
  });

  it("includes 'reCAPTCHA' generic keyword", () => {
    expect(CAPTCHA_ERROR_MESSAGES).toContain("reCAPTCHA");
  });

  it("includes English 'unusual traffic'", () => {
    expect(CAPTCHA_ERROR_MESSAGES.some((s) => s.includes("unusual traffic"))).toBe(true);
  });

  it("includes German text", () => {
    expect(CAPTCHA_ERROR_MESSAGES.some((s) => s.includes("ungewöhnlichen"))).toBe(true);
  });
});
