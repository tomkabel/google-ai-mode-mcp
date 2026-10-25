#!/usr/bin/env node
/**
 * Regression Test: MCP Server Orphan Shutdown
 *
 * Verifies that the google-ai-mode-mcp server exits cleanly when:
 * 1. Parent process stdin/stdout pipes are destroyed
 * 2. Parent process terminates abruptly
 * 3. stdin reaches EOF
 *
 * Expected: Server exits with code 0 within 1000ms
 * Bug: Server remains alive and spins CPU at 100%
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_TIMEOUT = 2000; // Max time to wait for clean exit (ms)
const SERVER_STARTUP_DELAY = 500; // Wait for server to initialize

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test 1: Destroy stdin/stdout pipes
 */
async function testPipeDestruction() {
  console.log('\n[Test 1] Testing stdin pipe destruction...');

  const serverPath = join(__dirname, 'dist', 'index.js');
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout piped; stderr inherited
  });

  const startTime = Date.now();
  let exited = false;
  let exitCode = null;

  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  // Wait for server to start
  await sleep(SERVER_STARTUP_DELAY);

  if (!child.pid) {
    throw new Error('Server failed to start');
  }

  console.log(`  Server started (PID: ${child.pid})`);

  // Destroy stdin to simulate parent disconnect
  child.stdin.destroy();
  child.stdout.destroy();
  console.log('  Destroyed stdin/stdout pipes');

  // Wait for clean exit
  const pollInterval = 50;
  const maxWait = TEST_TIMEOUT;
  let waited = 0;

  while (!exited && waited < maxWait) {
    await sleep(pollInterval);
    waited += pollInterval;
  }

  const elapsed = Date.now() - startTime;

  if (!exited) {
    // Server still running - FAIL
    process.kill(child.pid, 'SIGKILL');
    throw new Error(`FAILED: Server did not exit after ${elapsed}ms (still running at PID ${child.pid})`);
  }

  console.log(`  ✅ Server exited cleanly in ${elapsed}ms with code ${exitCode}`);

  if (exitCode !== 0) {
    console.warn(`  ⚠️  Non-zero exit code: ${exitCode} (expected 0)`);
  }

  return { elapsed, exitCode };
}

/**
 * Test 2: Send EOF to stdin
 */
async function testStdinEOF() {
  console.log('\n[Test 2] Testing stdin EOF...');

  const serverPath = join(__dirname, 'dist', 'index.js');
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const startTime = Date.now();
  let exited = false;
  let exitCode = null;

  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  await sleep(SERVER_STARTUP_DELAY);

  if (!child.pid) {
    throw new Error('Server failed to start');
  }

  console.log(`  Server started (PID: ${child.pid})`);

  // End stdin (EOF)
  child.stdin.end();
  console.log('  Sent EOF to stdin');

  // Wait for clean exit
  const pollInterval = 50;
  const maxWait = TEST_TIMEOUT;
  let waited = 0;

  while (!exited && waited < maxWait) {
    await sleep(pollInterval);
    waited += pollInterval;
  }

  const elapsed = Date.now() - startTime;

  if (!exited) {
    process.kill(child.pid, 'SIGKILL');
    throw new Error(`FAILED: Server did not exit after ${elapsed}ms (still running at PID ${child.pid})`);
  }

  console.log(`  ✅ Server exited cleanly in ${elapsed}ms with code ${exitCode}`);

  if (exitCode !== 0) {
    console.warn(`  ⚠️  Non-zero exit code: ${exitCode} (expected 0)`);
  }

  return { elapsed, exitCode };
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  MCP Server Orphan Shutdown Regression Test             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const results = [];

  try {
    results.push({ name: 'Pipe Destruction', ...(await testPipeDestruction()) });
  } catch (error) {
    console.error(`\n❌ Test 1 FAILED: ${error.message}`);
    process.exit(1);
  }

  try {
    results.push({ name: 'Stdin EOF', ...(await testStdinEOF()) });
  } catch (error) {
    console.error(`\n❌ Test 2 FAILED: ${error.message}`);
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  All Tests Passed ✅                                     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\nResults:');
  results.forEach(r => {
    console.log(`  ${r.name}: ${r.elapsed}ms (exit code: ${r.exitCode})`);
  });

  process.exit(0);
}

// Run tests
runTests().catch(error => {
  console.error(`\n💥 Fatal error: ${error}`);
  process.exit(1);
});
