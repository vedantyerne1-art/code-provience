const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCrashLineNumber, formatOriginLabel } = require('../src/runner');

test('parseCrashLineNumber parses Python tracebacks accurately', () => {
  const pythonStderr = `Traceback (most recent call last):
  File "calculate.py", line 24, in <module>
    result = compute(x)
ZeroDivisionError: division by zero`;

  const line = parseCrashLineNumber(pythonStderr);
  assert.equal(line, 24);
});

test('parseCrashLineNumber parses Node.js / TypeScript stack traces accurately', () => {
  const nodeStderr = `/app/src/index.js:42
    throw new Error('Database connection failed');
    ^

Error: Database connection failed
    at connect (/app/src/index.js:42:11)
    at Object.<anonymous> (/app/src/index.js:55:1)`;

  const line = parseCrashLineNumber(nodeStderr);
  assert.equal(line, 42);
});

test('parseCrashLineNumber returns null for stderr without line numbers', () => {
  const simpleStderr = 'Fatal: command not found';
  const line = parseCrashLineNumber(simpleStderr);
  assert.equal(line, null);
});

test('formatOriginLabel produces human-readable provenance origins', () => {
  assert.equal(formatOriginLabel('ai'), 'AI-Generated');
  assert.equal(formatOriginLabel('typed'), 'Human-Typed');
  assert.equal(formatOriginLabel('pasted'), 'Pasted from Clipboard');
  assert.equal(formatOriginLabel('ignore'), 'Whitespace / Ignored');
  assert.equal(formatOriginLabel('unknown'), 'Unknown / Pre-existing');
});
