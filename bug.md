Here is a professional, senior-level bug report analyzing the exact behavior shown in your `htop` capture. You can copy and paste this directly into a GitHub Issue or internal ticketing system.

---

# Bug Report: `google-ai-mode-mcp` Enters Unbounded CPU Spin Loop (~100% Core Utilization)

**Severity:** High (Resource Exhaustion / System Degradation)  
**Component:** `google-ai-mode-mcp` (Node.js MCP Server)  
**Environment:** 
* **OS:** Linux (CachyOS / Arch-based, systemd, Wayland/KWin, `ananicy-cpp` active)
* **Runtime:** Node.js (invoked ephemerally via `npx`)
* **Parent/Client:** `codex` CLI (`codex --dangerously-bypass-approvals-and-sandbox`)

---

## 1. Executive Summary
The `google-ai-mode-mcp` process enters a persistent, runaway CPU spin loop, saturating a full logical CPU core (`108.6%` CPU utilization) indefinitely. Over a system uptime of ~43.5 hours, this single MCP server process has accumulated **31 hours and 38 minutes (`1d07h38m`) of pure CPU time**, causing sustained thermal load (~70°C–72°C across cores) and elevated system load averages.

---

## 2. Observed Evidence (from `htop` Telemetry)

* **PID:** `2222504` (User: `notroot`)
* **Command:** `node /home/notroot/.npm/_npx/829042dde6a076d3/node_modules/.bin/google-ai-mode-mcp`
* **Process State:** `R` (Running — actively executing on-CPU, not blocked on I/O)
* **CPU Utilization:** `108.6%` (Single-threaded event loop saturation + V8 background/GC threads)
* **Accumulated CPU Time (`TIME+`):** `1d07h38m` (31.63 CPU hours out of 43.61 hours total system uptime)
* **Memory Footprint:** `VIRT: 1762M` | `RES: 316M` | `SHR: 23696` (`1.0%` MEM)
* **Scheduler Priority:** `PRI: 36`, `NI: 16` (Automatically deprioritized by `ananicy-cpp` due to sustained CPU abuse)
* **Kernel Pressure:** Noticeable red (kernel/system time) bars across all 8 threads in the CPU meters, indicating high syscall frequency (e.g., tight `epoll_wait`, `read`/`write` on closed/broken pipes, or rapid timer firing).

---

## 3. Technical Root Cause Analysis (Senior Assessment)

Because Node.js is single-threaded at the JS execution layer, a sustained ~100%+ CPU footprint combined with heavy kernel-space (red bar) activity across cores strongly points to one of the following classic MCP server failure modes:

### Hypothesis A: Orphaned Process / Broken `stdio` Pipe Spin (Most Likely)
MCP servers typically communicate with their host client (observed here as `codex`, PID `3620254`, which only has `3:11.76` of CPU time) over `stdin`/`stdout`. 
* The `google-ai-mode-mcp` process has been running significantly longer than the active `codex` instance.
* When the previous parent client exited or disconnected, `stdin` reached `EOF`. If the MCP server's transport layer does not properly listen for `process.stdin.on('end')`, `close`, or `SIGTERM`/`SIGHUP`, a naive `while` loop or stream reader may continuously poll a closed file descriptor, resulting in an immediate, zero-cost return from the kernel (`read() == 0`) that spins the event loop at 100% CPU with heavy syscall overhead.

### Hypothesis B: Unbounded `setImmediate` / `process.nextTick` / Promise Microtask Loop
An internal state machine or retry mechanism (such as polling for a browser instance, checking connection readiness, or retrying a failed Google AI Mode scrape/API request) is failing synchronously and re-scheduling itself without a backoff timer (`setTimeout`), starving the libuv I/O phase.

### Hypothesis C: Headless Browser / WebSocket Reconnection Storm
Given `google-ai-mode-mcp` typically bridges to a browser or remote debugging port, if the target browser context closed or crashed, an improperly handled WebSocket/CDP disconnect handler may be firing synchronous reconnection attempts in a tight loop.

---

## 4. Steps to Reproduce
1. Launch an MCP-capable client (e.g., `codex`) configured to spawn `npx google-ai-mode-mcp`.
2. Execute a tool call or allow the MCP server to initialize.
3. Terminate, restart, or disconnect the parent MCP client session (or allow the underlying connection to timeout).
4. Observe `htop`: the `node .../google-ai-mode-mcp` process remains alive in state `R` consuming `>100%` CPU indefinitely.

---

## 5. Immediate Diagnostic Commands (Before Killing the Process)
To capture the exact line of code causing the spin before terminating PID `2222504`, run the following as `root`:

1. **Check for syscall / `stdio` EOF spinning:**
   ```bash
   sudo strace -p 2222504 -c
   # And to see real-time calls:
   sudo strace -p 2222504 -T -tt -e trace=all 2>&1 | head -n 50
   ```
   *(If you see thousands of `read(0, "", ...)` or `epoll_wait` returning `0` instantly, it confirms Hypothesis A).*

2. **Check open file descriptors (verify if `stdin`/`stdout` pipes are broken/orphaned):**
   ```bash
   sudo ls -l /proc/2222504/fd
   ```

3. **Capture a V8 CPU Profile / Stack Trace via `perf` or `gdb`:**
   ```bash
   # Send SIGUSR1 to start the Node.js inspector dynamically:
   kill -USR1 2222504
   # Then attach via Chrome DevTools (chrome://inspect) to take a 5-second CPU profile.
   ```

---

## 6. Recommended Remediation (Code Fix)

1. **Enforce Graceful Shutdown on `stdio` Closure:**
   Ensure the MCP transport layer explicitly terminates the Node process when the parent client disconnects:
   ```javascript
   process.stdin.on('end', () => process.exit(0));
   process.stdin.on('close', () => process.exit(0));
   process.on('SIGTERM', () => process.exit(0));
   process.on('SIGHUP', () => process.exit(0));
   ```
2. **Add Exponential Backoff to Retry Loops:**
   Audit all `while` loops, connection pollers, and error handlers to ensure no retry path executes synchronously without an `await new Promise(r => setTimeout(r, backoffMs))`.

**Immediate Workaround for User:**  
Terminate the runaway process immediately via `kill -9 2222504` (or press `F9` -> `SIGKILL` in `htop`).
