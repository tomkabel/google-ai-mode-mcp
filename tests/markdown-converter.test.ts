import { describe, it, expect, beforeEach } from "vitest";
import { MarkdownConverter } from "../src/search/markdown-converter.js";
import { MarkdownConversionError } from "../src/errors.js";

describe("MarkdownConverter", () => {
  let converter: MarkdownConverter;

  beforeEach(() => {
    converter = new MarkdownConverter();
  });

  // Import beforeEach from vitest at top — fix the import
  // Actually we need to import it properly:

  describe("convertToMarkdown", () => {
    it("converts simple HTML to markdown", () => {
      const html = "<h1>Title</h1><p>Hello world</p>";
      const md = converter.convertToMarkdown(html);
      expect(md).toContain("Title");
      expect(md).toContain("Hello world");
      expect(md).toContain("#");
    });

    it("converts lists", () => {
      const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
      const md = converter.convertToMarkdown(html);
      expect(md).toContain("Item 1");
      expect(md).toContain("Item 2");
      // Bullet list marker should be *
      expect(md).toContain("*");
    });

    it("converts links", () => {
      const html = '<a href="https://example.com">Link</a>';
      const md = converter.convertToMarkdown(html);
      expect(md).toContain("[Link](https://example.com)");
    });

    it("converts code blocks", () => {
      const html = "<pre><code>const x = 1;</code></pre>";
      const md = converter.convertToMarkdown(html);
      expect(md).toContain("const x = 1;");
    });

    it("removes script and style tags", () => {
      const html =
        '<script>alert("xss")</script><style>body{}</style><p>Text</p>';
      const md = converter.convertToMarkdown(html);
      expect(md).not.toContain("alert");
      expect(md).not.toContain("body{}");
      expect(md).toContain("Text");
    });

    it("throws on empty HTML", () => {
      expect(() => converter.convertToMarkdown("")).toThrow(MarkdownConversionError);
      expect(() => converter.convertToMarkdown("   ")).toThrow(MarkdownConversionError);
    });

    it("throws on null", () => {
      expect(() => converter.convertToMarkdown(null as any)).toThrow(MarkdownConversionError);
    });
  });

  describe("embedCitations", () => {
    it("replaces [CITE-N] markers with [N] footnotes", () => {
      const md = "Some text [CITE-0] more text [CITE-1]";
      const citations = [
        {
          marker_id: 0,
          marker: "[CITE-0]",
          sources: [
            { title: "A", url: "http://a.com", domain: "a.com" },
          ],
        },
        {
          marker_id: 1,
          marker: "[CITE-1]",
          sources: [
            { title: "B", url: "http://b.com", domain: "b.com" },
            { title: "C", url: "http://c.com", domain: "c.com" },
          ],
        },
      ];

      const result = converter.embedCitations(md, citations, []);
      expect(result.markdown).toContain("[1]");
      expect(result.markdown).toContain("[2][3]");
      expect(result.markdown).not.toContain("[CITE-");
      expect(result.sources.length).toBe(3);
    });

    it("handles citations with no sources (removes marker)", () => {
      const md = "Text [CITE-0] end";
      const citations = [
        { marker_id: 0, marker: "[CITE-0]", sources: [] },
      ];
      const result = converter.embedCitations(md, citations, []);
      // Marker should be cleaned up
      expect(result.markdown).not.toContain("[CITE-");
    });

    it("handles empty citations", () => {
      const md = "No citations here";
      const result = converter.embedCitations(md, [], []);
      expect(result.markdown).toBe("No citations here");
      expect(result.sources.length).toBe(0);
    });

    it("preserves marker order (sorted highest first for replacement)", () => {
      const md = "[CITE-0] and [CITE-1]";
      const citations = [
        {
          marker_id: 0,
          marker: "[CITE-0]",
          sources: [{ title: "A", url: "http://a.com", domain: "a.com" }],
        },
        {
          marker_id: 1,
          marker: "[CITE-1]",
          sources: [{ title: "B", url: "http://b.com", domain: "b.com" }],
        },
      ];
      const result = converter.embedCitations(md, citations, []);
      // CITE-0 should get [1], CITE-1 should get [2]
      expect(result.markdown).toBe("[1] and [2]");
      expect(result.sources[0].title).toBe("A");
      expect(result.sources[1].title).toBe("B");
    });

    it("numbers citations in document order regardless of input order", () => {
      // Regression: sorting with `marker_id || 999` treated the valid id 0 as
      // missing, so the first citation in the text was numbered last.
      const md = "zero [CITE-0] one [CITE-1] two [CITE-2]";
      const citations = [
        { marker_id: 2, sources: [{ title: "C", url: "http://c", domain: "c" }] },
        { marker_id: 0, sources: [{ title: "A", url: "http://a", domain: "a" }] },
        { marker_id: 1, sources: [{ title: "B", url: "http://b", domain: "b" }] },
      ];

      const result = converter.embedCitations(md, citations, []);

      expect(result.markdown).toBe("zero [1] one [2] two [3]");
      expect(result.sources.map((s) => s.title)).toEqual(["A", "B", "C"]);
    });

    it("keeps footnote numbers aligned with the sources list for multi-source citations", () => {
      const md = "a [CITE-0] b [CITE-1]";
      const citations = [
        {
          marker_id: 0,
          sources: [
            { title: "A1", url: "http://a1", domain: "a1" },
            { title: "A2", url: "http://a2", domain: "a2" },
          ],
        },
        { marker_id: 1, sources: [{ title: "B1", url: "http://b1", domain: "b1" }] },
      ];

      const result = converter.embedCitations(md, citations, []);

      expect(result.markdown).toBe("a [1][2] b [3]");
      expect(result.sources.map((s) => s.title)).toEqual(["A1", "A2", "B1"]);
    });

    it("drops markers whose citation yielded no sources without shifting numbering", () => {
      const md = "a [CITE-0] b [CITE-1] c [CITE-2]";
      const citations = [
        { marker_id: 0, sources: [{ title: "A", url: "http://a", domain: "a" }] },
        { marker_id: 1, sources: [] },
        { marker_id: 2, sources: [{ title: "C", url: "http://c", domain: "c" }] },
      ];

      const result = converter.embedCitations(md, citations, []);

      expect(result.markdown).toBe("a [1] b  c [2]");
      expect(result.sources.map((s) => s.title)).toEqual(["A", "C"]);
    });

    it("does not confuse [CITE-1] with [CITE-10]", () => {
      const md = "x [CITE-1] y [CITE-10]";
      const citations = [
        { marker_id: 1, sources: [{ title: "one", url: "http://1", domain: "1" }] },
        { marker_id: 10, sources: [{ title: "ten", url: "http://10", domain: "10" }] },
      ];

      const result = converter.embedCitations(md, citations, []);

      expect(result.markdown).toBe("x [1] y [2]");
      expect(result.sources.map((s) => s.title)).toEqual(["one", "ten"]);
    });
  });

  describe("postProcessMarkdown", () => {
    it("removes ==highlighting==", () => {
      const md = "This is ==highlighted== text";
      const result = converter.postProcessMarkdown(md);
      expect(result).not.toContain("==");
      expect(result).toContain("highlighted");
    });

    it("removes base64 images", () => {
      const md =
        "Text ![image](data:image/png;base64,iVBOR==) more text";
      const result = converter.postProcessMarkdown(md);
      expect(result).not.toContain("data:image");
      expect(result).not.toContain("base64");
      expect(result).toContain("Text");
      expect(result).toContain("more text");
    });

    it("removes empty links []()", () => {
      const md = "Text [](https://example.com) more";
      const result = converter.postProcessMarkdown(md);
      expect(result).not.toContain("[](");
    });

    it("cuts off at disclaimer markers", () => {
      const md = "Main content here.\n\nAI-generated answers may contain mistakes\n\nMore stuff";
      const result = converter.postProcessMarkdown(md);
      expect(result).toContain("Main content");
      expect(result).not.toContain("More stuff");
    });

    it("cuts off at German disclaimer", () => {
      const md = "Inhalt.\n\nKI-Antworten können Fehler enthalten\n\nMehr";
      const result = converter.postProcessMarkdown(md);
      expect(result).toContain("Inhalt");
      expect(result).not.toContain("Mehr");
    });

    it("cuts off at Estonian disclaimer", () => {
      const md = "Sisu.\n\nAI vastused võivad sisaldada vigu\n\nRohkem";
      const result = converter.postProcessMarkdown(md);
      expect(result).toContain("Sisu");
      expect(result).not.toContain("Rohkem");
    });

    it("merges single-newline broken sentences", () => {
      const md = "This is a\nsentence that\nshould be merged";
      const result = converter.postProcessMarkdown(md);
      // Single newlines between non-punctuation and non-list chars should be merged
      expect(result).toContain("This is a sentence");
    });

    it("reduces multiple blank lines to max 2", () => {
      const md = "Para 1\n\n\n\n\n\nPara 2";
      const result = converter.postProcessMarkdown(md);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it("trims leading/trailing whitespace", () => {
      const md = "  \n\n  Text here  \n\n  ";
      const result = converter.postProcessMarkdown(md);
      expect(result.startsWith("Text")).toBe(true);
      expect(result.endsWith("here")).toBe(true);
    });

    it("preserves markdown headings", () => {
      const md = "# Title\n\n## Section\n\nContent";
      const result = converter.postProcessMarkdown(md);
      expect(result).toContain("# Title");
      expect(result).toContain("## Section");
    });

    it("preserves bullet lists", () => {
      const md = "* Item 1\n* Item 2\n* Item 3";
      const result = converter.postProcessMarkdown(md);
      expect(result).toContain("* Item 1");
      expect(result).toContain("* Item 2");
      expect(result).toContain("* Item 3");
    });
  });

  describe("convert (full pipeline)", () => {
    it("converts HTML with citations end-to-end", () => {
      // The HTML from response-parser has <span class="citation-marker"><code>[CITE-0]</code></span> injected
      const html =
        '<div data-container-id="main-col"><h1>AI Answer</h1><p>The answer is 42.</p><span class="citation-marker"><code>[CITE-0]</code></span></div>';
      const citations = [
        {
          marker_id: 0,
          marker: "[CITE-0]",
          sources: [
            { title: "Source A", url: "https://example.com/a", domain: "example.com" },
          ],
        },
      ];

      const result = converter.convert(html, citations as any, []);
      expect(result.markdown).toContain("AI Answer");
      expect(result.markdown).toContain("The answer is 42");
      expect(result.markdown).toContain("[1]");
      expect(result.markdown).toContain("## Sources");
      expect(result.markdown).toContain("Source A");
      expect(result.markdown).toContain("https://example.com/a");
      expect(result.sources.length).toBe(1);
      expect(result.sources[0].title).toBe("Source A");
    });

    it("handles HTML with no citations (sources empty)", () => {
      const html = "<p>Just some text with no citations</p>";
      const result = converter.convert(html, [], []);
      expect(result.markdown).toContain("Just some text");
      expect(result.sources.length).toBe(0);
      // Should not have a sources section
      expect(result.markdown).not.toContain("## Sources");
    });

    it("appends sources section after post-processing", () => {
      const html = '<p>Content</p><span class="citation-marker"><code>[CITE-0]</code></span>';
      const citations = [
        {
          marker_id: 0,
          marker: "[CITE-0]",
          sources: [
            { title: "Src1", url: "https://a.com", domain: "a.com" },
            { title: "Src2", url: "https://b.com", domain: "b.com" },
          ],
        },
      ];

      const result = converter.convert(html, citations as any, []);
      const lines = result.markdown.split("\n");
      // Sources section should be at the end
      const sourcesIdx = lines.indexOf("## Sources:");
      expect(sourcesIdx).toBeGreaterThan(-1);
      // Everything after sources section should contain source entries
      const afterSources = lines.slice(sourcesIdx).join("\n");
      expect(afterSources).toContain("Src1");
      expect(afterSources).toContain("Src2");
      expect(afterSources).toContain("https://a.com");
      expect(afterSources).toContain("https://b.com");
    });
  });
});


