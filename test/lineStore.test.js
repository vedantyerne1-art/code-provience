const test = require('node:test');
const assert = require('node:assert/strict');
const { LineStore } = require('../src/lineStore');

test('insert at top of file', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Start with 3 lines tagged "typed"
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: 'line 1\nline 2\nline 3' }, 'typed', 100);
  assert.equal(store.getLines(uri).length, 3);
  assert.equal(store.getLines(uri)[0].origin, 'typed');

  // Insert 2 newlines at top of file (line 0) with "ai"
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\n\n' }, 'ai', 200);

  const lines = store.getLines(uri);
  // Total lines should be 3 + 2 = 5
  assert.equal(lines.length, 5);
  // Top lines are ai
  assert.equal(lines[0].origin, 'ai');
  assert.equal(lines[1].origin, 'ai');
  assert.equal(lines[2].origin, 'ai');
  // Original lines shifted down to indices 3 and 4
  assert.equal(lines[3].origin, 'typed');
  assert.equal(lines[4].origin, 'typed');
});

test('delete a line in the middle', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Seed 4 lines: 0=typed, 1=ai, 2=pasted, 3=typed
  store.getOrCreate(uri);
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\n\n\n' }, 'unknown', 10);
  store.getLines(uri)[0].origin = 'typed';
  store.getLines(uri)[1].origin = 'ai';
  store.getLines(uri)[2].origin = 'pasted';
  store.getLines(uri)[3].origin = 'typed';

  // Delete line 1 (range: start line 1, end line 2, text empty)
  store.applyChange(uri, { range: { start: { line: 1 }, end: { line: 2 } }, text: '' }, 'unknown', 50);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].origin, 'typed');
  assert.equal(lines[1].origin, 'pasted'); // formerly line 2, now shifted up to line 1
  assert.equal(lines[2].origin, 'typed');  // formerly line 3, now shifted up to line 2
});

test('replace a multi-line block with a different number of lines', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Seed 5 lines: all typed
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\n\n\n\n' }, 'typed', 10);
  assert.equal(store.getLines(uri).length, 5);

  // Replace lines 1-4 (3 lines removed) with 1 line (no \n in replacement text)
  // linesRemoved = 4 - 1 = 3, linesAdded = 0 -> net remove 3 lines
  store.applyChange(uri, { range: { start: { line: 1 }, end: { line: 4 } }, text: 'replaced' }, 'pasted', 30);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].origin, 'typed');
  assert.equal(lines[1].origin, 'pasted');
});

test('paste multiple lines at the very end', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Seed 2 lines
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\n' }, 'typed', 10);
  assert.equal(store.getLines(uri).length, 2);

  // Paste 3 lines at line 1 (end of file)
  store.applyChange(uri, { range: { start: { line: 1 }, end: { line: 1 } }, text: 'extra\nsecond\nthird' }, 'pasted', 40);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 4); // 2 + 2 additional lines
  assert.equal(lines[0].origin, 'typed');
  assert.equal(lines[1].origin, 'pasted');
  assert.equal(lines[2].origin, 'pasted');
  assert.equal(lines[3].origin, 'pasted');
});

test('two sequential edits in a row carry state correctly', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Edit 1: Type on line 0
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: 'a' }, 'typed', 10);
  assert.equal(store.getLines(uri).length, 1);
  assert.equal(store.getLines(uri)[0].origin, 'typed');

  // Edit 2: Press enter to create a second line and paste
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\npasted text' }, 'pasted', 20);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].origin, 'pasted');
  assert.equal(lines[1].origin, 'pasted');
});

test('pasting a block with empty lines tags blank lines as ignore', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // Paste a 4-line snippet where line 1 is empty
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: 'func main() {\n\n    fmt.Println()\n}' }, 'pasted', 10);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].origin, 'pasted');
  assert.equal(lines[1].origin, 'ignore');
  assert.equal(lines[2].origin, 'pasted');
  assert.equal(lines[3].origin, 'pasted');
});

test('inserting blank lines tags them as ignore', () => {
  const store = new LineStore();
  const uri = 'file:///test.js';

  // User hits Enter 3 times (origin: ignore)
  store.applyChange(uri, { range: { start: { line: 0 }, end: { line: 0 } }, text: '\n\n\n' }, 'ignore', 15);

  const lines = store.getLines(uri);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].origin, 'ignore');
  assert.equal(lines[1].origin, 'ignore');
  assert.equal(lines[2].origin, 'ignore');
  assert.equal(lines[3].origin, 'ignore');
});
