const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePercentages } = require('../src/decorations');

test('calculatePercentages computes correct distribution', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'pasted' },
    { origin: 'ai' }
  ];

  // typed: 2/4 = 50%, pasted: 1/4 = 25%, ai: 1/4 = 25%
  const result = calculatePercentages(lines);
  assert.equal(result, 'Typed 50% | Pasted 25% | AI 25%');
});

test('calculatePercentages handles empty array safely', () => {
  const result = calculatePercentages([]);
  assert.equal(result, 'Typed 0% | Pasted 0% | AI 0%');
});

test('calculatePercentages rounds percentages', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'ai' }
  ];

  // typed: 2/3 = 67%, ai: 1/3 = 33%
  const result = calculatePercentages(lines);
  assert.equal(result, 'Typed 67% | Pasted 0% | AI 33%');
});

test('calculatePercentages excludes ignore and unknown lines from denominator', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'ignore' },
    { origin: 'ignore' },
    { origin: 'unknown' },
    { origin: 'typed' }
  ];

  // 2 typed out of 2 meaningful = 100% typed, ignore/unknown excluded
  const result = calculatePercentages(lines);
  assert.equal(result, 'Typed 100% | Pasted 0% | AI 0%');
});
