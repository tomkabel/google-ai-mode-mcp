/**
 * MCP Tool Handler for Google AI Search
 */

import * as fs from "fs";
import * as path from "path";
import type { SearchResult, SearchOptions, ProgressCallback } from "../types.js";
import { SearchHandler, failed } from "../search/search-handler.js";
import { CONFIG } from "../config.js";
import { log } from "../utils/logger.js";

/** Markdown is scraped web text reaching an LLM; fence it so the client can tell data from instructions. */
export const UNTRUSTED_BEGIN = "<<<UNTRUSTED_WEB_CONTENT>>>";
export const UNTRUSTED_END = "<<<END_UNTRUSTED_WEB_CONTENT>>>";

export class ToolHandler {
  private searchHandler: SearchHandler;
  // ponytail: single-flight queue. One browser context, one search at a time;
  // a CAPTCHA-driven context swap would otherwise close it under a sibling call.
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.searchHandler = new SearchHandler();
  }

  /**
   * Handle search_ai tool call
   */
  async handleSearchAi(
    args: {
      query: string;
      headless?: boolean;
      timeout_ms?: number;
      resolve_source_urls?: boolean;
      save_to_file?: boolean;
      filename?: string;
    },
    sendProgress: ProgressCallback
  ): Promise<SearchResult> {
    const run = this.chain.then(() => this.handleSearchAiSerial(args, sendProgress));
    this.chain = run.catch(() => {});
    return run;
  }

  private async handleSearchAiSerial(
    args: Parameters<ToolHandler["handleSearchAi"]>[0],
    sendProgress: ProgressCallback
  ): Promise<SearchResult> {
    try {
      const { query, headless, timeout_ms, resolve_source_urls, save_to_file, filename } = args;

      // Validate query
      if (!query || query.trim().length === 0) {
        return failed("", "EMPTY_QUERY", "Query cannot be empty");
      }

      log.info(`🔍 Tool call: search_ai("${query}")`);

      // Build options
      const options: SearchOptions = {};
      if (headless !== undefined) {
        options.headless = headless;
      }
      if (timeout_ms !== undefined) {
        options.timeout_ms = timeout_ms;
      }
      if (resolve_source_urls !== undefined) {
        options.resolve_source_urls = resolve_source_urls;
      }

      // Send progress: Starting search
      await sendProgress("Navigating to Google AI Search...");

      // Execute search
      // No zero-source re-search: missing sources is selector drift, which a
      // second identical run cannot fix. It surfaces as status "degraded" instead.
      const result = await this.searchHandler.executeSearch(query, options);

      // Save to file if requested and search was successful
      if (save_to_file && result.success && result.markdown) {
        try {
          await sendProgress("Saving result to file...");
          const savedPath = await this.saveToFile(
            result.markdown,
            query,
            filename
          );
          result.savedTo = savedPath;
          log.success(`📄 Saved to: ${savedPath}`);
        } catch (error) {
          log.warning(`Failed to save file: ${error}`);
          result.saveError = error instanceof Error ? error.message : String(error);
        }
      }

      if (result.markdown) {
        result.markdown = `${UNTRUSTED_BEGIN}\n${result.markdown.replace(/[<>](?=(?:\\*[<>]){2})/g, "$& ")}\n${UNTRUSTED_END}`;
      }

      // Send progress based on result
      if (result.success) {
        await sendProgress(`Search completed (${result.status})`, 100, 100);
      } else if (result.captchaRequired) {
        await sendProgress(
          "CAPTCHA detected - please solve in visible browser"
        );
      } else {
        await sendProgress(`Search failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      log.error(`Tool handler error: ${error}`);

      return failed(args.query || "", "INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Save markdown result to file
   * @param markdown - The markdown content to save
   * @param query - The search query (used for auto-generated filename)
   * @param customFilename - Optional custom filename
   * @returns Path to the saved file
   */
  private async saveToFile(
    markdown: string,
    query: string,
    customFilename?: string
  ): Promise<string> {
    // Create results directory
    const resultsDir = path.join(CONFIG.dataDir, "results");
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Generate filename
    let filename: string;
    if (customFilename) {
      // basename() strips any path: `filename` arrives from the model, which may
      // be echoing attacker-controlled page text, and "../../../.bashrc" would
      // otherwise be an arbitrary-file-write primitive.
      const base = path.basename(customFilename);
      if (!base || base === "." || base === "..") {
        throw new Error(`Invalid filename: ${customFilename}`);
      }
      filename = base.endsWith(".md") ? base : `${base}.md`;
    } else {
      // Auto-generate from query and timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/T/, "_")
        .replace(/:/g, "-")
        .split(".")[0]; // YYYY-MM-DD_HH-MM-SS
      const safeName = query
        .substring(0, 40) // Max 40 chars
        .replace(/[^a-zA-Z0-9]/g, "_") // Replace non-alphanumeric with _
        .replace(/_+/g, "_") // Collapse multiple underscores
        .replace(/^_|_$/g, ""); // Trim underscores from start/end
      filename = `${timestamp}_${safeName}.md`;
    }

    // Write file
    const filePath = path.join(resultsDir, filename);
    fs.writeFileSync(filePath, markdown, "utf-8");

    return filePath;
  }

  /**
   * Cleanup handler
   */
  async cleanup(): Promise<void> {
    await this.searchHandler.cleanup();
  }
}
