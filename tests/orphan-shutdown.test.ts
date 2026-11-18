/**
 * Regression: host exits and closes ALL stdio pipes (stdin, stdout, stderr).
 *
 * Before the fix, the shutdown log line hit EPIPE on stderr. Node's console
 * swallows only synchronous write errors, so the async 'error' event became an
 * uncaughtException, whose handler logged to stderr again -> EPIPE -> ... an
 * endless nextTick loop that starved the event loop at 100% CPU.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

/** utime+stime of a live pid in clock ticks (Linux only). */
function cpuTicks(pid: number): number {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return Number(fields[11]) + Number(fields[12]);
}

describe.runIf(process.platform === "linux")("orphaned stdio shutdown", () => {
  it("exits promptly without spinning when every stdio pipe is closed", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait until the server is connected and logging.
    await new Promise<void>((ok, fail) => {
      const t = setTimeout(() => fail(new Error("server never became ready")), 10_000);
      child.stderr.on("data", (b: Buffer) => {
        if (b.toString().includes("MCP Server connected")) {
          clearTimeout(t);
          ok();
        }
      });
    });

    const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
    const ticksBefore = cpuTicks(child.pid!);

    // Simulate the host vanishing: close our ends of all three pipes.
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();

    const code = await Promise.race([
      exited,
      new Promise<"hung">((ok) => setTimeout(() => ok("hung"), 5_000)),
    ]);

    if (code === "hung") {
      const burned = cpuTicks(child.pid!) - ticksBefore;
      child.kill("SIGKILL");
      throw new Error(`server still alive 5s after host disconnect, burned ${burned} CPU ticks`);
    }
    expect(code).toBe(0);
  });
});
