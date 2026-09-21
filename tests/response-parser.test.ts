import { describe, it, expect } from "vitest";
import { citationFromLabel } from "../src/search/response-parser.js";

// Labels captured from a live AI Mode page (2026-09).
const LIVE_LABEL =
  "QuEra Computing (+1) – What Is Quantum Tunneling? Applications & Challenges - QuEra. Seotud tulemused";
const LIVE_URL =
  "https://www.google.com/goto?url=CAESaAHrOzAVb0W_pNidT2hvz2oqihBjM5pSjBjEJoQoKoBPyF-PsTNpHrGrLpVQZJtT2L";

describe("citationFromLabel", () => {
  it("parses publisher and title out of a live label", () => {
    const source = citationFromLabel(LIVE_LABEL, LIVE_URL);

    expect(source).toEqual({
      title: "What Is Quantum Tunneling? Applications & Challenges - QuEra",
      url: LIVE_URL,
      domain: "QuEra Computing",
    });
  });

  it("keeps Google /goto redirect URLs", () => {
    // Regression: the old extractor dropped every URL containing "google.com",
    // which is every citation URL Google now ships - searches returned zero
    // sources even when citations were found.
    expect(citationFromLabel(LIVE_LABEL, LIVE_URL)?.url).toBe(LIVE_URL);
  });

  it("strips the localized 'related results' suffix", () => {
    for (const suffix of ["Seotud tulemused", "Related results", "Zugehörige Ergebnisse"]) {
      const source = citationFromLabel(`Wikipedia – Quantum tunnelling. ${suffix}`, LIVE_URL);
      expect(source?.title).toBe("Quantum tunnelling");
    }
  });

  it("drops the '(+N)' collapsed-source counter from the publisher", () => {
    expect(citationFromLabel("Nature (+12) – Paper title", LIVE_URL)?.domain).toBe("Nature");
  });

  it("handles a title that itself contains a dash", () => {
    const source = citationFromLabel("BBC – Climate – what changed. Related results", LIVE_URL);
    expect(source?.domain).toBe("BBC");
    expect(source?.title).toBe("Climate – what changed");
  });

  it("falls back to the publisher when there is no title", () => {
    const source = citationFromLabel("Wikipedia. Related results", LIVE_URL);
    expect(source).toEqual({ title: "Wikipedia", url: LIVE_URL, domain: "Wikipedia" });
  });

  it("falls back to the hostname when there is no publisher", () => {
    const source = citationFromLabel(" – Some article", "https://example.com/a");
    expect(source?.domain).toBe("example.com");
    expect(source?.title).toBe("Some article");
  });

  it("returns null for the bare group button (label is only the suffix)", () => {
    expect(citationFromLabel("Seotud tulemused", LIVE_URL)).toBeNull();
    expect(citationFromLabel("Related results", LIVE_URL)).toBeNull();
  });

  it("returns null when there is no link to cite", () => {
    expect(citationFromLabel(LIVE_LABEL, null)).toBeNull();
  });

  it("returns null for an empty label", () => {
    expect(citationFromLabel("", LIVE_URL)).toBeNull();
    expect(citationFromLabel("   ", LIVE_URL)).toBeNull();
  });

  it("does not throw on a malformed URL when deriving the hostname", () => {
    expect(() => citationFromLabel("– Title", "not a url")).not.toThrow();
    expect(citationFromLabel("– Title", "not a url")?.domain).toBe("");
  });
});
