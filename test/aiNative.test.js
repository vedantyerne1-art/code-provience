const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyChange, markInlineSuggestCommitted } = require('../src/tracker');
const { calculatePercentages } = require('../src/decorations');

test('classifyChange tags single char human typing as typed', async () => {
  const res = await classifyChange('a');
  assert.equal(res, 'typed');
});

test('classifyChange tags blank or whitespace text as ignore', async () => {
  const res = await classifyChange('   \n  ');
  assert.equal(res, 'ignore');
});

test('classifyChange tags recent inline suggestion acceptance as ai-native', async () => {
  markInlineSuggestCommitted();
  const res = await classifyChange('function calculate()');
  assert.equal(res, 'ai-native');
});

test('classifyChange with forcedAiNative returns ai-native', async () => {
  const res = await classifyChange('const x = 42;', true);
  assert.equal(res, 'ai-native');
});

test('calculatePercentages formats AI-Native percentage separately when present', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'typed' },
    { origin: 'ai-native' },
    { origin: 'ai-native' }
  ];

  // 2 typed, 2 ai-native => 50% typed, 50% ai-native
  const result = calculatePercentages(lines);
  assert.equal(result, 'Typed 50% | Pasted 0% | AI 0% | AI-Native 50%');
});

test('calculatePercentages omits AI-Native when count is zero for backwards compatibility', () => {
  const lines = [
    { origin: 'typed' },
    { origin: 'pasted' },
    { origin: 'ai' }
  ];

  const result = calculatePercentages(lines);
  assert.equal(result, 'Typed 33% | Pasted 33% | AI 33%');
});
