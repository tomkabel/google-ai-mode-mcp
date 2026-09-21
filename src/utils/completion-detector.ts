/**
 * AI Completion Detection Utility
 *
 * Single polling loop over one page snapshot per tick. Completion is accepted
 * only once the answer region actually holds a non-trivial answer, via:
 *   1. feedback button visible (fast, appears right after streaming ends)
 *   2. localized "AI generated" disclaimer text
 *   3. answer text stopped growing across several consecutive polls
 *   4. overall timeout - scrape whatever is on the page
 *
 * The content gate matters: Google's chrome (nav icons, tool buttons) renders
 * within ~400ms, long before the answer streams, so any signal that ignores
 * answer length fires on an empty page and the extractor scrapes nothing.
 */

import type { Page } from "patchright";
import { log } from "./logger.js";
import {
  AI_COMPLETION_BUTTON_ARIA,
  OVERALL_COMPLETION_TIMEOUT,
  AI_COMPLETION_TEXT_INDICATORS,
} from "../constants/language-constants.js";

export interface CompletionResult {
  success: boolean;
  method: "button" | "text" | "content" | "timeout";
  elapsed: number;
}

const POLL_MS = 500;
/** Below this the answer region is chrome/placeholder, not an answer. */
const MIN_ANSWER_CHARS = 200;
/** Consecutive unchanged polls before "stopped growing" is believed. */
const STABLE_POLLS_REQUIRED = 4;

interface PageSnapshot {
  answerLen: number;
  buttonVisible: boolean;
  matchedIndicator: string | null;
}

/**
 * Wait for the AI response to finish streaming.
 * Always resolves (never throws on detection failure) - callers proceed with
 * whatever is rendered, which is still better than failing the search.
 */
export async function waitForAiCompletion(
  page: Page,
  timeoutMs: number = OVERALL_COMPLETION_TIMEOUT
): Promise<CompletionResult> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  log.info("⏳ Waiting for AI completion...");

  let lastLen: number | null = null;
  let stablePolls = 0;

  const done = (method: CompletionResult["method"], detail: string) => {
    const elapsed = Date.now() - startTime;
    log.success(`✅ AI complete (${method}: ${detail}) (${elapsed}ms)`);
    return { success: true, method, elapsed };
  };

  while (Date.now() < deadline) {
    let snap: PageSnapshot | null = null;
    try {
      snap = await page.evaluate(
        ([ariaSel, indicators]: [string, string[]]) => {
          const region = document.querySelector(
            '[data-container-id="main-col"]'
          ) as HTMLElement | null;
          // Fall back to body if Google renames the container, so detection
          // degrades instead of silently timing out on every search.
          const answerText = (region ?? document.body)?.innerText ?? "";

          const btn = document.querySelector(ariaSel) as HTMLElement | null;
          const buttonVisible = !!btn && btn.offsetParent !== null;

          const matchedIndicator =
            (indicators as string[]).find((i) => answerText.includes(i)) ?? null;

          return {
            answerLen: answerText.trim().length,
            buttonVisible,
            matchedIndicator,
          };
        },
        [AI_COMPLETION_BUTTON_ARIA, AI_COMPLETION_TEXT_INDICATORS] as [string, string[]]
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/browser has been closed|target closed|page has been closed/i.test(msg)) {
        throw new Error("Browser closed while waiting for AI content");
      }
      // Transient evaluate failure (navigation mid-poll) - try again next tick.
      log.debug(`Completion poll failed (retrying): ${msg}`);
    }

    if (snap && snap.answerLen >= MIN_ANSWER_CHARS) {
      if (snap.buttonVisible) {
        return done("button", "feedback button visible");
      }
      if (snap.matchedIndicator) {
        return done("text", snap.matchedIndicator);
      }
      stablePolls = snap.answerLen === lastLen ? stablePolls + 1 : 0;
      if (stablePolls >= STABLE_POLLS_REQUIRED) {
        return done("content", `${snap.answerLen} chars stable`);
      }
    }
    if (snap) lastLen = snap.answerLen;

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const elapsed = Date.now() - startTime;
  log.warning(
    `⏱️  No completion signal within ${timeoutMs}ms - scraping loaded content`
  );
  return { success: true, method: "timeout", elapsed };
}

/**
 * Check if AI Mode is available in the current region/language
 */
export async function checkAiModeAvailability(page: Page): Promise<boolean> {
  log.info("🌍 Checking AI Mode availability...");

  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const { AI_MODE_NOT_AVAILABLE } = await import("../constants/language-constants.js");

    for (const indicator of AI_MODE_NOT_AVAILABLE) {
      if (bodyText.includes(indicator)) {
        log.error(`❌ AI Mode not available: "${indicator}"`);
        return false;
      }
    }

    log.debug("AI Mode available, proceeding...");
    return true;
  } catch (error) {
    log.debug(`Could not check AI Mode availability: ${error instanceof Error ? error.message : String(error)}`);
    // Proceed anyway - don't block on this check
    return true;
  }
}
