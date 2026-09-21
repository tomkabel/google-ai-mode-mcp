/**
 * Response Parser for Google AI Search Mode
 *
 * Injects [CITE-N] markers next to each citation button and reads the source
 * off the button itself: the aria-label carries "<Publisher> (+N) – <Title>"
 * and the adjacent anchor carries the link.
 *
 * The page script stays deliberately dumb (collect label + href); all parsing
 * happens in Node where it is unit-testable.
 */

import type { Page } from "patchright";
import type { Citation, Source } from "../types.js";
import { log } from "../utils/logger.js";
import { CONFIG } from "../config.js";
import { CitationExtractionError } from "../errors.js";
import { CITATION_SELECTORS } from "../constants/language-constants.js";

// DOM selectors
const MAIN_CONTAINER = '[data-container-id="main-col"]';

/** Trailing "related results" phrasing Google appends to every citation label. */
const LABEL_SUFFIXES = [
  "Seotud tulemused",
  "Related results",
  "Zugehörige Ergebnisse",
  "Résultats associés",
  "Resultados relacionados",
  "Risultati correlati",
  "Gerelateerde resultaten",
];

export interface RawCitation {
  marker_id: number;
  label: string;
  url: string | null;
}

/**
 * Turn a citation button's aria-label + href into a Source.
 * Label shape: "QuEra Computing (+1) – What Is Quantum Tunneling? - QuEra. Seotud tulemused"
 * Returns null when the label carries no publisher/title (e.g. the bare
 * "Seotud tulemused" group button) or when there is no link to cite.
 */
export function citationFromLabel(label: string, url: string | null): Source | null {
  if (!url) return null;

  let text = (label || "").trim();
  for (const suffix of LABEL_SUFFIXES) {
    if (text.toLowerCase().endsWith(suffix.toLowerCase())) {
      text = text.slice(0, text.length - suffix.length).trim();
      break;
    }
  }
  text = text.replace(/[.\s]+$/, "");
  if (!text) return null;

  // Publisher and title are separated by an en/em dash; the "(+N)" counts extra
  // sources collapsed into the same chip and is noise for a citation list.
  const [publisherPart, ...titleParts] = text.split(/\s*[–—]\s+/);
  const publisher = publisherPart.replace(/\s*\(\+\d+\)\s*$/, "").trim();
  const title = titleParts.join(" – ").trim();

  if (!publisher && !title) return null;

  return {
    title: title || publisher,
    url,
    domain: publisher || hostnameOf(url),
  };
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export class ResponseParser {
  /**
   * Extract AI response HTML (with [CITE-N] markers injected) and its citations.
   */
  async extractAiResponse(
    page: Page,
    timeoutMs: number = CONFIG.responseTimeout
  ): Promise<{ html: string; citations: Citation[] }> {
    try {
      log.info("📚 Injecting Markers & Extracting Sources...");

      try {
        await page.waitForSelector(MAIN_CONTAINER, {
          state: "visible",
          timeout: timeoutMs,
        });
      } catch (error) {
        log.error("Main container not found - AI Overview missing?");
        throw new CitationExtractionError("AI Overview container not found");
      }

      // Expand collapsed sections first, then give the page a real (non-blocking)
      // tick to render. The previous implementation busy-waited inside
      // evaluate(), which pins the page's only JS thread - nothing it waited
      // for could ever happen.
      await page.evaluate(() => {
        const mainCol = document.querySelector('[data-container-id="main-col"]');
        if (!mainCol) return;
        const expandLabels = ["Show more", "Mehr anzeigen", "Meer weergeven", "Kuva rohkem"];
        for (const btn of Array.from(
          mainCol.querySelectorAll('[aria-expanded="false"]')
        )) {
          const el = btn as HTMLElement;
          if (expandLabels.some((t) => (el.innerText || "").includes(t))) {
            el.click();
          }
        }
      });
      await page.waitForTimeout(300);

      const result = await page.evaluate((selectors) => {
        function isVisible(el: any): boolean {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            el.offsetParent !== null &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        const mainCol = document.querySelector('[data-container-id="main-col"]');
        if (!mainCol) {
          return { error: "main-col not found (AI Overview missing?)" };
        }

        let buttons: Element[] = [];
        for (const selector of selectors) {
          const found = Array.from(mainCol.querySelectorAll(selector));
          if (found.some((b) => isVisible(b as HTMLElement))) {
            buttons = found;
            break;
          }
        }

        const citations: { marker_id: number; label: string; url: string | null }[] = [];
        let markerIndex = 0;

        for (const btn of buttons) {
          const btnEl = btn as HTMLElement;
          if (!isVisible(btnEl)) continue;

          // The link lives on the button itself, an ancestor, or a sibling
          // inside the same chip - take the first one that exists.
          const anchor =
            (btnEl.closest("a[href]") as HTMLAnchorElement | null) ??
            (btnEl.parentElement?.querySelector("a[href]") as HTMLAnchorElement | null) ??
            null;

          const label = btnEl.getAttribute("aria-label") || "";
          if (!anchor && !label) continue;

          const markerId = markerIndex++;
          const marker = document.createElement("span");
          marker.className = "citation-marker";
          marker.innerHTML = `<code>[CITE-${markerId}]</code>`;
          if (btnEl.nextSibling) {
            btnEl.parentNode?.insertBefore(marker, btnEl.nextSibling);
          } else {
            btnEl.parentNode?.appendChild(marker);
          }

          citations.push({
            marker_id: markerId,
            label,
            // href is already absolute; Google currently serves an opaque
            // /goto?url=... redirect rather than the publisher URL.
            url: anchor ? anchor.href : null,
          });
        }

        return { html: mainCol.innerHTML, citations };
      }, CITATION_SELECTORS);

      if ("error" in result) {
        throw new CitationExtractionError(result.error as string);
      }

      const { html, citations: raw } = result as {
        html: string;
        citations: RawCitation[];
      };

      if (!html || html.trim().length === 0) {
        throw new CitationExtractionError("No AI response HTML found");
      }

      const citations: Citation[] = raw.map((c) => {
        const source = citationFromLabel(c.label, c.url);
        return {
          marker_id: c.marker_id,
          marker: `[CITE-${c.marker_id}]`,
          sources: source ? [source] : [],
        };
      });

      const totalSources = citations.reduce((sum, c) => sum + c.sources.length, 0);
      log.success(
        `✅ Extracted ${citations.length} citations with ${totalSources} total sources`
      );
      if (citations.length > 0 && totalSources === 0) {
        log.warning(
          "⚠️  Citation buttons found but no sources parsed - citation selectors or label format may have changed"
        );
      }

      return { html, citations };
    } catch (error) {
      log.error(`Failed to extract AI response: ${error}`);
      throw new CitationExtractionError(`Extraction failed: ${error}`);
    }
  }
}
