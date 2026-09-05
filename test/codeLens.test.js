const test = require('node:test');
const assert = require('node:assert/strict');
const { findFunctionBlocks, calculateBlockProvenance } = require('../src/codeLens');

test('findFunctionBlocks detects JavaScript and TypeScript functions', () => {
  const code = `
function calculateSum(a, b) {
  const c = a + b;
  return c;
}

const multiply = (x, y) => {
  return x * y;
};

class DataProcessor {
  process() {
    return true;
  }
}
`;

  const blocks = findFunctionBlocks(code, 'javascript');
  assert.ok(blocks.length >= 3);
  assert.equal(blocks[0].name, 'calculateSum');
  assert.equal(blocks[0].startLine, 1);
  assert.equal(blocks[0].endLine, 4);

  assert.equal(blocks[1].name, 'multiply');
  assert.equal(blocks[1].startLine, 6);
  assert.equal(blocks[1].endLine, 8);

  assert.equal(blocks[2].name, 'DataProcessor');
});

test('findFunctionBlocks detects Python def and class blocks', () => {
  const pyCode = `def greet_user(name):
    print("Hello", name)
    return True

class Validator:
    def check(self):
        return True
`;

  const blocks = findFunctionBlocks(pyCode, 'python');
  assert.ok(blocks.length >= 2);
  assert.equal(blocks[0].name, 'greet_user');
  assert.equal(blocks[0].startLine, 0);
  assert.equal(blocks[0].endLine, 2);

  assert.equal(blocks[1].name, 'Validator');
  assert.equal(blocks[1].startLine, 4);
});

test('calculateBlockProvenance accurately calculates 100% Human for hand-written function', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'typed' }
  ];

  const stats = calculateBlockProvenance(lines, 0, 4);
  assert.equal(stats.humanPct, 100);
  assert.equal(stats.aiTotalPct, 0);
  assert.equal(stats.pastedPct, 0);
  assert.equal(stats.label, '⚖️ Origin: 100% Human');
});

test('calculateBlockProvenance accurately calculates 100% Pasted/AI for generated function', () => {
  const lines = [
    { origin: 'typed' }, // before function
    { origin: 'pasted' },
    { origin: 'pasted' },
    { origin: 'pasted' },
    { origin: 'pasted' },
    { origin: 'typed' } // after function
  ];

  const stats = calculateBlockProvenance(lines, 1, 4);
  assert.equal(stats.humanPct, 0);
  assert.equal(stats.pastedPct, 100);
  assert.equal(stats.label, '⚖️ Origin: 100% Pasted/AI');
});

test('calculateBlockProvenance computes mixed Human and AI distribution', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'ai-native' }
  ];

  // 4 typed (80%), 1 ai-native (20%)
  const stats = calculateBlockProvenance(lines, 0, 4);
  assert.equal(stats.humanPct, 80);
  assert.equal(stats.aiTotalPct, 20);
  assert.equal(stats.label, '⚖️ Origin: 80% Human | 20% AI');
});
