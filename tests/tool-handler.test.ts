import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolHandler } from "../src/tools/tool-handler.js";
import type { SearchResult, ProgressCallback } from "../src/types.js";

// Mock the SearchHandler so we don't launch a real browser
vi.mock("../src/search/search-handler.js", () => {
  return {
    SearchHandler: class {
      executeSearch = vi.fn();
      cleanup = vi.fn().mockResolvedValue(undefined);
    },
  };
});

describe("ToolHandler", () => {
  let handler: ToolHandler;
  let mockExecuteSearch: ReturnType<typeof vi.fn>;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let progressCallback: ProgressCallback;

  beforeEach(async () => {
    vi.clearAllMocks();
    handler = new ToolHandler();
    mockExecuteSearch = (handler as any).searchHandler.executeSearch;
    mockCleanup = (handler as any).searchHandler.cleanup;
    progressCallback = vi.fn() as any;
  });

  describe("handleSearchAi", () => {
    it("returns error for empty query", async () => {
      const result = await handler.handleSearchAi(
        { query: "" },
        progressCallback
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("empty");
      expect(mockExecuteSearch).not.toHaveBeenCalled();
    });

    it("returns error for whitespace-only query", async () => {
      const result = await handler.handleSearchAi(
        { query: "   " },
        progressCallback
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("calls executeSearch with correct query", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "## Answer\n\nThe answer is 42.",
        sources: [{ title: "S", url: "http://s.com", domain: "s.com" }],
        query: "test query",
      });

      const result = await handler.handleSearchAi(
        { query: "test query" },
        progressCallback
      );

      expect(result.success).toBe(true);
      expect(result.markdown).toContain("answer is 42");
      expect(mockExecuteSearch).toHaveBeenCalledWith("test query", {});
    });

    it("passes headless option through", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Answer",
        sources: [],
        query: "test",
      });

      await handler.handleSearchAi(
        { query: "test", headless: false },
        progressCallback
      );

      expect(mockExecuteSearch).toHaveBeenCalledWith("test", { headless: false });
    });

    it("passes timeout_ms option through", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Answer",
        sources: [],
        query: "test",
      });

      await handler.handleSearchAi(
        { query: "test", timeout_ms: 60000 },
        progressCallback
      );

      expect(mockExecuteSearch).toHaveBeenCalledWith("test", { timeout_ms: 60000 });
    });

    it("retries when zero sources but has markdown", async () => {
      mockExecuteSearch
        .mockResolvedValueOnce({
          success: true,
          markdown: "Some answer text",
          sources: [],
          query: "test query",
        })
        .mockResolvedValueOnce({
          success: true,
          markdown: "Better answer",
          sources: [{ title: "S1", url: "http://s1.com", domain: "s1.com" }],
          query: "test query MUST provide 3-5 sources",
        });

      const result = await handler.handleSearchAi(
        { query: "test query" },
        progressCallback
      );

      expect(mockExecuteSearch).toHaveBeenCalledTimes(2);
      // Second call should include the retry nudge
      expect(mockExecuteSearch).toHaveBeenNthCalledWith(
        2,
        "test query MUST provide 3-5 sources",
        {}
      );
      // Result should have the user's original query, not the retry query
      expect(result.query).toBe("test query");
      expect(result.sources.length).toBe(1);
    });

    it("does NOT retry when sources exist", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Answer",
        sources: [{ title: "S", url: "http://s.com", domain: "s.com" }],
        query: "test",
      });

      await handler.handleSearchAi({ query: "test" }, progressCallback);

      expect(mockExecuteSearch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry when markdown is empty", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "",
        sources: [],
        query: "test",
      });

      await handler.handleSearchAi({ query: "test" }, progressCallback);

      expect(mockExecuteSearch).toHaveBeenCalledTimes(1);
    });

    it("handles search failure gracefully", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: false,
        markdown: "",
        sources: [],
        query: "test",
        error: "Search failed",
      });

      const result = await handler.handleSearchAi(
        { query: "test" },
        progressCallback
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Search failed");
    });

    it("handles executeSearch throwing an error", async () => {
      mockExecuteSearch.mockRejectedValue(new Error("Browser crashed"));

      const result = await handler.handleSearchAi(
        { query: "test" },
        progressCallback
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Browser crashed");
    });

    it("sends progress notifications", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Answer",
        sources: [],
        query: "test",
      });

      await handler.handleSearchAi({ query: "test" }, progressCallback);

      // Should have sent at least: "Navigating..." and "Search completed..."
      expect(progressCallback).toHaveBeenCalled();
      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall).toContain("Navigating");
    });

    it("sends final progress on success", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Answer",
        sources: [],
        query: "test",
      });

      await handler.handleSearchAi({ query: "test" }, progressCallback);

      const lastCall = progressCallback.mock.calls[progressCallback.mock.calls.length - 1];
      expect(lastCall[0]).toContain("completed");
      expect(lastCall[1]).toBe(100);
      expect(lastCall[2]).toBe(100);
    });
  });

  describe("saveToFile", () => {
    it("saves markdown to file when save_to_file is true", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "# Test Result\n\nContent here",
        sources: [],
        query: "test",
      });

      const result = await handler.handleSearchAi(
        { query: "test", save_to_file: true, filename: "test-result" },
        progressCallback
      );

      expect(result.savedTo).toBeTruthy();
      expect(result.savedTo).toContain("test-result.md");
      // Verify file was actually created
      const fs = await import("fs");
      expect(fs.existsSync(result.savedTo!)).toBe(true);
      const content = fs.readFileSync(result.savedTo!, "utf-8");
      expect(content).toContain("Test Result");
    });

    it("uses custom filename with .md extension", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Content",
        sources: [],
        query: "test",
      });

      const result = await handler.handleSearchAi(
        { query: "test", save_to_file: true, filename: "custom-name" },
        progressCallback
      );

      expect(result.savedTo).toContain("custom-name.md");
    });

    it("refuses to escape the results dir via a traversal filename", async () => {
      // `filename` is model-supplied and may echo attacker-controlled page text,
      // so it must never resolve outside CONFIG.dataDir/results.
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "pwned",
        sources: [],
        query: "test",
      });
      const { CONFIG } = await import("../src/config.js");
      const path = await import("path");
      const resultsDir = path.join(CONFIG.dataDir, "results");

      for (const evil of [
        "../../../../tmp/evil",
        "..\\..\\evil",
        "/etc/cron.d/evil",
        "subdir/../../escape",
      ]) {
        const result = await handler.handleSearchAi(
          { query: "test", save_to_file: true, filename: evil },
          progressCallback
        );

        expect(result.saveError ?? "").not.toContain("ENOENT");
        if (result.savedTo) {
          expect(path.dirname(path.resolve(result.savedTo))).toBe(
            path.resolve(resultsDir)
          );
        }
      }
    });

    it("reports a save error instead of throwing for a degenerate filename", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "x",
        sources: [],
        query: "test",
      });

      const result = await handler.handleSearchAi(
        { query: "test", save_to_file: true, filename: ".." },
        progressCallback
      );

      expect(result.success).toBe(true); // a bad filename must not fail the search
      expect(result.saveError).toMatch(/Invalid filename/);
      expect(result.savedTo).toBeUndefined();
    });

    it("auto-generates filename from query when not provided", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Content",
        sources: [],
        query: "what is typescript",
      });

      const result = await handler.handleSearchAi(
        { query: "what is typescript", save_to_file: true },
        progressCallback
      );

      expect(result.savedTo).toBeTruthy();
      expect(result.savedTo).toMatch(/\.md$/);
      // Should contain sanitized query text
      expect(result.savedTo).toMatch(/typescript/i);
    });

    it("does not save when save_to_file is false", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: true,
        markdown: "Content",
        sources: [],
        query: "test",
      });

      const result = await handler.handleSearchAi(
        { query: "test", save_to_file: false },
        progressCallback
      );

      expect(result.savedTo).toBeUndefined();
    });

    it("does not save when search failed", async () => {
      mockExecuteSearch.mockResolvedValue({
        success: false,
        markdown: "",
        sources: [],
        query: "test",
        error: "Failed",
      });

      const result = await handler.handleSearchAi(
        { query: "test", save_to_file: true },
        progressCallback
      );

      expect(result.savedTo).toBeUndefined();
    });
  });

  describe("cleanup", () => {
    it("calls cleanup on search handler", async () => {
      await handler.cleanup();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
