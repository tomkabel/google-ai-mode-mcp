import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForAiCompletion, checkAiModeAvailability } from "../src/utils/completion-detector.js";
import { OVERALL_COMPLETION_TIMEOUT } from "../src/constants/language-constants.js";

/**
 * The real page is driven through `page.evaluate`, so a fake page that returns
 * a scripted sequence of snapshots is enough to exercise every branch, with
 * fake timers keeping the 40s budget instant.
 */
function fakePage(snapshots: any[]) {
  let i = 0;
  const evaluate = vi.fn(async () => {
    const snap = snapshots[Math.min(i, snapshots.length - 1)];
    i++;
    if (snap instanceof Error) throw snap;
    return snap;
  });
  return { page: { evaluate } as any, calls: () => i };
}

const snap = (answerLen: number, opts: Partial<{ buttonVisible: boolean; matchedIndicator: string | null }> = {}) => ({
  answerLen,
  buttonVisible: opts.buttonVisible ?? false,
  matchedIndicator: opts.matchedIndicator ?? null,
});

/** Advance fake timers until the promise settles (poll loop sleeps 500ms). */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < 400 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(500);
  }
  return p;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("waitForAiCompletion", () => {
  it("does NOT complete while the answer region is still empty", async () => {
    // Regression: a generic icon selector used to report completion at ~400ms
    // with a 0-char answer, so the extractor scraped nothing.
    const { page } = fakePage([
      snap(0, { buttonVisible: true, matchedIndicator: "AI-generated" }),
    ]);

    const result = await runWithTimers(waitForAiCompletion(page));

    expect(result.method).toBe("timeout");
    expect(result.elapsed).toBeGreaterThanOrEqual(OVERALL_COMPLETION_TIMEOUT);
  });

  it("ignores a below-threshold answer (chrome/placeholder text)", async () => {
    const { page } = fakePage([snap(199, { buttonVisible: true })]);
    const result = await runWithTimers(waitForAiCompletion(page));
    expect(result.method).toBe("timeout");
  });

  it("completes via feedback button once the answer is non-trivial", async () => {
    const { page } = fakePage([
      snap(0, { buttonVisible: true }), // nav icons present, answer not streamed
      snap(50, { buttonVisible: true }),
      snap(900, { buttonVisible: true }),
    ]);

    const result = await runWithTimers(waitForAiCompletion(page));

    expect(result.success).toBe(true);
    expect(result.method).toBe("button");
  });

  it("completes via localized text indicator", async () => {
    const { page } = fakePage([
      snap(0),
      snap(900, { matchedIndicator: "AI vastused" }),
    ]);
    const result = await runWithTimers(waitForAiCompletion(page));
    expect(result.method).toBe("text");
  });

  it("completes via content stability after the answer stops growing", async () => {
    const { page } = fakePage([
      snap(100),
      snap(400),
      snap(800),
      snap(1200),
      snap(1200),
      snap(1200),
      snap(1200),
      snap(1200),
    ]);

    const result = await runWithTimers(waitForAiCompletion(page));

    expect(result.method).toBe("content");
  });

  it("does not call a stalled stream complete before the stability window", async () => {
    // Length pauses for 2 polls mid-stream, then grows again: must keep waiting.
    const { page } = fakePage([
      snap(300),
      snap(300),
      snap(300),
      snap(900),
      snap(900),
      snap(900),
      snap(900),
      snap(900),
    ]);

    const result = await runWithTimers(waitForAiCompletion(page));

    expect(result.method).toBe("content");
    // 4 stable polls are needed *after* the resume, so it cannot have returned
    // during the mid-stream pause.
    expect(result.elapsed).toBeGreaterThanOrEqual(3 * 500);
  });

  it("times out and proceeds when nothing ever renders", async () => {
    const { page } = fakePage([snap(0)]);
    const result = await runWithTimers(waitForAiCompletion(page));
    expect(result.success).toBe(true);
    expect(result.method).toBe("timeout");
  });

  it("throws when the browser goes away mid-wait", async () => {
    const { page } = fakePage([new Error("Target closed")]);
    await expect(runWithTimers(waitForAiCompletion(page))).rejects.toThrow(
      /Browser closed/
    );
  });

  it("retries transient evaluate failures instead of aborting", async () => {
    const { page } = fakePage([
      new Error("Execution context was destroyed, most likely because of a navigation"),
      snap(900, { buttonVisible: true }),
    ]);

    const result = await runWithTimers(waitForAiCompletion(page));

    expect(result.method).toBe("button");
  });
});

describe("checkAiModeAvailability", () => {
  it("returns false when the region-block notice is present", async () => {
    const page = {
      evaluate: vi.fn(async () => "AI Mode is not available in your country or language"),
    } as any;
    await expect(checkAiModeAvailability(page)).resolves.toBe(false);
  });

  it("returns false for the Estonian notice", async () => {
    const page = {
      evaluate: vi.fn(async () => "AI-režiim pole teie seadmes ega kontol praegu saadaval"),
    } as any;
    await expect(checkAiModeAvailability(page)).resolves.toBe(false);
  });

  it("returns true for a normal page", async () => {
    const page = { evaluate: vi.fn(async () => "Quantum tunneling is ...") } as any;
    await expect(checkAiModeAvailability(page)).resolves.toBe(true);
  });

  it("fails open when the check itself errors", async () => {
    const page = {
      evaluate: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as any;
    await expect(checkAiModeAvailability(page)).resolves.toBe(true);
  });
});
