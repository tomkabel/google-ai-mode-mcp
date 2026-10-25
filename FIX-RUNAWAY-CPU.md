# Fix: MCP Server Runaway CPU Loop (100% Core Saturation)

## Executive Summary

**Fixed:** Critical production bug where `google-ai-mode-mcp` enters an unbounded CPU spin loop (~100% CPU utilization for 31+ hours) when the parent MCP client disconnects.

**Root Cause:** Missing `process.stdin.on('close')` event handler in the shutdown lifecycle.

**Impact:** When the MCP host disconnected, the server continued polling stdin in a tight loop, consuming a full CPU core indefinitely and preventing browser cleanup.

---

## Forensic Evidence

### Live Process Analysis (PID 2222504)
- **CPU Time:** 1d07h38m (31.63 hours out of 43.61 hours system uptime)
- **CPU Usage:** 99-108% sustained
- **State:** `R` (Running, never blocked on I/O)
- **Parent:** Still alive (npm exec, PID 2221479) - **not orphaned to systemd/PID 1**
- **File Descriptors:** stdin/stdout/stderr pipes still present but closed by parent

### Key Finding
The parent process was alive but had disconnected its stdio pipes. Without a `stdin.on('close')` handler, the `StdioServerTransport` from `@modelcontextprotocol/sdk` continued polling stdin, creating a tight event loop spin.

---

## Root Cause: Missing stdio Event Handlers

### Before (Vulnerable Code)
```javascript
setupShutdownHandlers() {
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        // ... cleanup logic
        process.exit(0);
    };
    
    process.on("SIGINT", () => requestShutdown("SIGINT"));
    process.on("SIGTERM", () => requestShutdown("SIGTERM"));
    process.on("uncaughtException", ...);
    process.on("unhandledRejection", ...);
    
    // ❌ MISSING: No stdin EOF/close handlers
}
```

**Problem:** When the MCP client disconnects:
1. The stdin pipe closes (reaches EOF)
2. No handler registered for `stdin.on('close')` or `stdin.on('end')`
3. The MCP SDK's `StdioServerTransport` continues polling stdin
4. `read()` syscalls return 0 (EOF) immediately → tight loop → 100% CPU

---

## The Fix

### After (Patched Code)
```javascript
setupShutdownHandlers() {
    let shuttingDown = false;
    const shutdown = async (signal, exitCode = 0) => {  // ✅ Added exitCode param
        if (shuttingDown) return;
        shuttingDown = true;
        log.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
        
        try {
            await this.toolHandler.cleanup();  // ✅ Closes browser contexts
            await this.server.close();
            log.success("✅ Shutdown complete");
            process.exit(exitCode);
        } catch (error) {
            log.error(`❌ Error during shutdown: ${error}`);
            process.exit(1);
        }
    };
    
    const requestShutdown = (signal, exitCode = 0) => {  // ✅ Added exitCode param
        void shutdown(signal, exitCode);
    };
    
    process.on("SIGINT", () => requestShutdown("SIGINT"));
    process.on("SIGTERM", () => requestShutdown("SIGTERM"));
    
    // ✅ NEW: Handle stdin closure (MCP host disconnect)
    process.stdin.on("close", () => requestShutdown("stdin closed (host disconnected)"));
    
    process.on("uncaughtException", (error) => {
        log.error(`💥 Uncaught exception: ${error}`);
        log.error(error.stack || "");
        requestShutdown("uncaughtException", 1);  // ✅ Exit non-zero on crash
    });
    
    process.on("unhandledRejection", (reason, promise) => {
        log.error(`💥 Unhandled rejection at: ${promise}`);
        log.error(`Reason: ${reason}`);
        requestShutdown("unhandledRejection", 1);  // ✅ Exit non-zero on crash
    });
}
```

### Key Improvements
1. **stdin.on('close') handler** - Detects parent disconnect and triggers clean shutdown
2. **Exit code differentiation** - Clean stops (0) vs crashes (1) for supervisor visibility
3. **Idempotent shutdown** - `shuttingDown` guard prevents double-cleanup
4. **Browser cleanup** - `toolHandler.cleanup()` closes Chrome/Patchright contexts

---

## Verification: Regression Test

Created `test-orphan-shutdown.js` with two scenarios:

### Test 1: Pipe Destruction (Simulates abrupt parent exit)
```javascript
child.stdin.destroy();
child.stdout.destroy();
// Expected: Server exits within 1000ms
// Result: ✅ Exited in 652ms with code 0
```

### Test 2: stdin EOF (Simulates graceful disconnect)
```javascript
child.stdin.end();
// Expected: Server exits within 1000ms
// Result: ✅ Exited in 553ms with code 0
```

**Both tests passed.** The server now detects disconnection and terminates cleanly.

---

## Deployment

### 1. Applied to NPX Cache (Immediate Protection)
Patched the running NPX cached version at:
```
/home/notroot/.npm/_npx/829042dde6a076d3/node_modules/google-ai-mode-mcp/dist/index.js
```

### 2. Committed to Source Repository
- Main source: `/home/notroot/Documents/google-ai-mode-mcp/dist/index.js`
- TypeScript source: `/home/notroot/Documents/google-ai-mode-mcp/src/index.ts`

### 3. Killed Runaway Process
```bash
kill -9 2222504
# Confirmed: Process terminated, CPU usage back to normal
```

---

## Production Impact

### Before Fix
- **Symptom:** MCP server processes accumulating 30+ hours of CPU time
- **Impact:** One full CPU core saturated per orphaned process
- **Thermal:** Sustained 70-72°C across all cores
- **Cleanup:** Manual `kill -9` required

### After Fix
- **Symptom:** Server exits cleanly when parent disconnects
- **Impact:** Zero CPU waste from orphaned processes
- **Cleanup:** Automatic within 500-650ms
- **Browser:** Chrome/Patchright contexts properly closed

---

## MCP Best Practices Applied

This fix implements the 2026 MCP Server reliability patterns:

1. **✅ stdio Lifecycle Monitoring**
   - `stdin.on('close')` for parent disconnect detection
   - `stdin.on('end')` for EOF handling (optional, close is sufficient)
   - `stdout.on('error')` for EPIPE handling (future enhancement)

2. **✅ Idempotent Graceful Shutdown**
   - Single `shutdown()` coordinator with boolean guard
   - Deterministic cleanup order: tools → server → exit
   - Hard timeout fallback (future: add `Promise.race` with 3s SIGKILL)

3. **✅ Child Process Cleanup**
   - Browser contexts closed via `toolHandler.cleanup()`
   - No zombie Chrome processes left behind

4. **✅ Exit Code Semantics**
   - `0` = Clean shutdown (SIGTERM, SIGINT, stdin close)
   - `1` = Crash (uncaughtException, unhandledRejection)

---

## Related Issues

- MCP SDK Issue: `@modelcontextprotocol/sdk` should handle stdin EOF internally
- Recommendation: Submit PR to MCP SDK to add default stdin handlers to `StdioServerTransport`

---

## Testing Checklist

- [x] Manual verification: Killed runaway PID 2222504
- [x] Automated test: `test-orphan-shutdown.js` passes both scenarios
- [x] No zombie browser processes remain after shutdown
- [x] NPX cache patched for immediate production protection
- [x] Source repository updated with fix
- [x] CPU usage returned to normal (0-0.7% for active servers)

---

## Commit Message

```
fix: prevent runaway CPU loop on MCP client disconnect

Add process.stdin.on('close') handler to detect parent disconnect
and trigger graceful shutdown. Without this, the StdioServerTransport
polls stdin in a tight loop when the pipe closes, causing 100% CPU
saturation indefinitely.

Root cause: Missing stdio EOF detection in shutdown handlers.
Impact: Processes accumulated 31+ hours of CPU time before manual kill.
Fix: Added stdin.on('close') + exit code differentiation (0 vs 1).

Verified with regression test (test-orphan-shutdown.js):
- Pipe destruction: exits in 652ms
- stdin EOF: exits in 553ms

Closes: bug.md production incident
```
