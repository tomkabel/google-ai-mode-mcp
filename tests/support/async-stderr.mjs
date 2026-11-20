// Fault injection for the deterministic sibling of tests/orphan-shutdown.test.ts.
//
// A real pipe whose reader is gone delivers EPIPE to the writer as an
// ASYNCHRONOUS 'error' event. `console.error` swallows only SYNCHRONOUS write
// errors, so in a live session the defect surfaces only when the async error
// wins the race against the shutdown path — which is why the frozen test's red
// varies with machine load (measured: 3 reds in 15 runs at the pre-fix commit).
//
// This wrapper forces every process.stderr write onto a later tick, so the
// failure can never be swallowed synchronously and the red becomes repeatable.
// It does not patch the server: it only changes *when* the write to a dead pipe
// reports its error, i.e. it makes the real-world race always resolve the
// hostile way. Verified: at the pre-fix commit the server then exits 1 with an
// uncaughtException 3/3 runs; with the shutdown fix it exits 0 3/3 runs.
const real = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk, enc, cb) {
  setImmediate(() => real(chunk, enc, cb));
  return true;
};
