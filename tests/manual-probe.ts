/**
 * Manual probe (not part of `npm test`): navigates the real flow and records
 * WHEN each completion signal fires vs. when the answer actually finishes
 * streaming, so completion-detection claims can be checked against reality.
 *
 * Run: HEADED=1 GOOGLE_AI_PROFILE_DIR=/tmp/gam-warm npx tsx tests/manual-probe.ts "query"
 */
import { chromium } from "patchright";
import {
  AI_COMPLETION_BUTTON_ARIA,
  CITATION_SELECTORS,
} from "../src/constants/language-constants.js";

const query = process.argv[2] || "node lts version";
const profile = process.env.GOOGLE_AI_PROFILE_DIR || "/tmp/gam-probe";

const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: !process.env.HEADED,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled", "--lang=en-US"],
  locale: "en-US",
});
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});

const samples: any[] = [];
for (let i = 0; i < 40; i++) {
  const s = await page
    .evaluate(
      ([ariaSel, citeSels]: any) => {
        const mc = document.querySelector('[data-container-id="main-col"]') as HTMLElement | null;
        return {
          svg: 0,
          aria: document.querySelectorAll(ariaSel).length,
          cites: (citeSels as string[]).reduce(
            (n, sel) => n + document.querySelectorAll(sel).length,
            0
          ),
          len: mc ? (mc.innerText || "").trim().length : 0,
          sorry: location.href.includes("/sorry/"),
        };
      },
      [AI_COMPLETION_BUTTON_ARIA, CITATION_SELECTORS]
    )
    .catch(() => null);
  if (s) samples.push({ t: Date.now() - t0, ...s });
  if (s?.sorry) break;
  await new Promise((r) => setTimeout(r, 500));
}

const first = (pred: (s: any) => boolean) => samples.find(pred)?.t ?? null;
const finalLen = samples.at(-1)?.len ?? 0;
console.log(
  JSON.stringify(
    {
      firstSvgMatch_ms: first((s) => s.svg > 0),
      firstAriaMatch_ms: first((s) => s.aria > 0),
      firstCitationMatch_ms: first((s) => s.cites > 0),
      answerReached50pct_ms: first((s) => s.len > finalLen * 0.5),
      answerReached95pct_ms: first((s) => s.len > finalLen * 0.95),
      finalLen,
      lenAtFirstSvgMatch: samples.find((s) => s.svg > 0)?.len ?? null,
      trail: samples.map((s) => `${s.t}:${s.len}/svg${s.svg}/c${s.cites}`),
    },
    null,
    2
  )
);
await ctx.close();
