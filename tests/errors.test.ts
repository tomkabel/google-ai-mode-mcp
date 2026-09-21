import { describe, it, expect } from "vitest";
import {
  CaptchaDetectedError,
  CaptchaTimeoutError,
  SearchTimeoutError,
  CitationExtractionError,
  MarkdownConversionError,
} from "../src/errors.js";

describe("Error classes", () => {
  it("CaptchaDetectedError has correct name and message", () => {
    const err = new CaptchaDetectedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CaptchaDetectedError");
    expect(err.message).toBe("CAPTCHA detected");
  });

  it("CaptchaDetectedError accepts custom message", () => {
    const err = new CaptchaDetectedError("Custom");
    expect(err.message).toBe("Custom");
  });

  it("CaptchaTimeoutError has correct name", () => {
    const err = new CaptchaTimeoutError();
    expect(err.name).toBe("CaptchaTimeoutError");
    expect(err.message).toBe("CAPTCHA solving timeout");
  });

  it("SearchTimeoutError has correct name", () => {
    const err = new SearchTimeoutError();
    expect(err.name).toBe("SearchTimeoutError");
    expect(err.message).toBe("Search response timeout");
  });

  it("CitationExtractionError has correct name", () => {
    const err = new CitationExtractionError();
    expect(err.name).toBe("CitationExtractionError");
    expect(err.message).toBe("Citation extraction failed");
  });

  it("MarkdownConversionError has correct name", () => {
    const err = new MarkdownConversionError();
    expect(err.name).toBe("MarkdownConversionError");
    expect(err.message).toBe("Markdown conversion failed");
  });

  it("all errors accept custom messages", () => {
    expect(new CaptchaDetectedError("a").message).toBe("a");
    expect(new CaptchaTimeoutError("b").message).toBe("b");
    expect(new SearchTimeoutError("c").message).toBe("c");
    expect(new CitationExtractionError("d").message).toBe("d");
    expect(new MarkdownConversionError("e").message).toBe("e");
  });
});
