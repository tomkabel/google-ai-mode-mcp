/**
 * Deterministic sibling of tests/orphan-shutdown.test.ts.
 *
 * That file is frozen (byte-identical, per the operator's "never edit that test
 * file") and its red is racy: the pre-fix defect only fires when the async EPIPE
 * from a dead log reader wins the race against the shutdown path, which under
 * low load it does not (measured: 3 reds in 15 runs at the pre-fix commit).
 *
 * This gate injects that race (tests/support/async-stderr.mjs) so it is
 * repeatable, and asserts the invariant the shutdown fix establishes:
 *
 *   With the host's log reader gone, the server must not die abnormally and
 *   must still exit 0 promptly.
 *
 * Measured, 3 runs each: pre-fix 5dc07f7 -> exit 1 via uncaughtException 3/3
 * (its uncaughtException handler logs to a dead stderr and aborts the process);
 * HEAD -> exit 0 3/3. The frozen test's predicate is "exits within 5s while
 * burning CPU ticks"; this one is "exits cleanly on a dead stderr, always".
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const INJECTOR = resolve(__dirname, "support", "async-stderr.mjs");
const EXIT_DEADLINE_MS = 2_000;

describe.runIf(process.platform === "linux")("dead-stderr shutdown (deterministic)", () => {
  it("exits 0 and does not raise an uncaughtException when the log reader is gone", async () => {
    const child = spawn(
      process.execPath,
      ["--import", INJECTOR, "--import", "tsx", "src/index.ts"],
      { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const exited = new Promise<string>((ok) =>
      child.on("exit", (code, signal) => ok(`${code ?? signal}`)),
    );

    // Prove the server is actually up before removing its log reader.
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "dead-stderr-gate", version: "1" },
        },
      })}\n`,
    );
    let stdout = "";
    const up = await new Promise<boolean>((ok) => {
      const t = setTimeout(() => ok(false), 15_000);
      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
        if (stdout.includes('"result"')) {
          clearTimeout(t);
          ok(true);
        }
      });
    });
    expect(up, "server never answered initialize").toBe(true);

    // The host vanished: its log reader is closed, then the shutdown path runs.
    child.stderr.destroy();
    child.stdin.destroy();
    const t0 = Date.now();
    child.kill("SIGTERM");

    const code = await Promise.race([
      exited,
      new Promise<"hung">((ok) => setTimeout(() => ok("hung"), EXIT_DEADLINE_MS)),
    ]);
    const ms = Date.now() - t0;

    if (code === "hung") {
      child.kill("SIGKILL");
      throw new Error(`did not exit within ${EXIT_DEADLINE_MS}ms of a dead log reader + SIGTERM`);
    }
    expect(stderr, `abnormal termination ${code} after ${ms}ms`).not.toContain("Uncaught exception");
    expect(code, `exit ${code} after ${ms}ms (stderr: ${stderr.slice(-300)})`).toBe("0");
  });
});
