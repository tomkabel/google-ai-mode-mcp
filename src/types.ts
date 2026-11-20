/**
 * Type definitions for Google AI Search Mode MCP Server
 */

/**
 * Search result returned by the MCP tool
 */
export type SearchStatus = "ok" | "degraded" | "failed";

export type SearchErrorCode =
  | "EMPTY_QUERY"
  | "EXTRACTION_EMPTY"
  | "AI_MODE_UNAVAILABLE"
  | "CAPTCHA_REQUIRED"
  | "INTERNAL_ERROR";

export interface SearchResult {
  /** `status !== "failed"`. Kept for backwards compatibility. */
  success: boolean;
  /** ok = full answer; degraded = usable but check `warnings`; failed = do not trust `markdown`. */
  status: SearchStatus;
  errorCode?: SearchErrorCode;
  warnings: string[];
  markdown: string;
  sources: Source[];
  query: string;
  captchaRequired?: boolean;
  error?: string;
  savedTo?: string; // Path to saved file (if save_to_file was true)
  saveError?: string; // Error message if saving failed
}

/** search_ai tool response: source fields are page text, so only their count leaves the fence. */
export type SearchToolResult = Omit<SearchResult, "sources"> & { sourceCount: number };

/**
 * Source information extracted from Google AI search
 */
export interface Source {
  title: string;
  url: string;
  domain: string;
}

/**
 * Citation information with position and source mapping
 */
export interface Citation {
  marker_id: number; // N in "[CITE-N]", assigned in document order
  marker: string; // e.g., "[CITE-1]"
  sources: Source[];
}

/**
 * CAPTCHA state tracking
 */
export interface CaptchaState {
  detected: boolean;
  url: string;
  attempts: number;
  solved: boolean;
  reason?: string; // URL, Text, or Length
}

/**
 * Search options that can be passed to the search handler
 */
export interface SearchOptions {
  headless?: boolean;
  timeout_ms?: number;
  /** Resolve Google /goto?url= redirects to publisher URLs (default true). */
  resolve_source_urls?: boolean;
}

/**
 * Progress callback function type for MCP progress notifications
 */
export type ProgressCallback = (
  message: string,
  progress?: number,
  total?: number
) => Promise<void>;
