/**
 * In-memory store for document line provenance tags.
 *
 * Data model per open document:
 * Array where index = line number (0-based) and value is:
 * { origin: "typed" | "pasted" | "ai" | "unknown", timestamp: number }
 *
 * ASCII Diagram: 2-line insert at index 1 in a 3-line file:
 *
 * BEFORE:
 * Index 0: [ Line 0: "typed" ]
 * Index 1: [ Line 1: "typed" ]  <-- User pastes 2 newlines at line 1
 * Index 2: [ Line 2: "typed" ]
 *
 * AFTER:
 * Index 0: [ Line 0: "typed"  ]  (unchanged)
 * Index 1: [ Line 1: "pasted" ]  (updated start line)
 * Index 2: [ Line 2: "pasted" ]  (spliced new line 1)
 * Index 3: [ Line 3: "pasted" ]  (spliced new line 2)
 * Index 4: [ Line 4: "typed"  ]  (former Index 2 correctly shifted down by +2)
 */

class LineStore {
  constructor() {
    /** @type {Map<string, Array<{origin: string, timestamp: number}>>} */
    this.documents = new Map();
  }

  /**
   * Initializes or gets the line array for a document URI.
   * @param {string} uri
   * @param {number} [lineCount=0]
   * @returns {Array<{origin: string, timestamp: number}>}
   */
  getOrCreate(uri, lineCount = 0) {
    if (!this.documents.has(uri)) {
      const initialLines = [];
      const now = Date.now();
      for (let i = 0; i < lineCount; i++) {
        initialLines.push({ origin: 'unknown', timestamp: now });
      }
      this.documents.set(uri, initialLines);
    }
    return this.documents.get(uri);
  }

  /**
   * Returns current lines for a document URI, or empty array if untracked.
   * @param {string} uri
   * @returns {Array<{origin: string, timestamp: number}>}
   */
  getLines(uri) {
    return this.documents.get(uri) || [];
  }

  /**
   * Applies a single content change and shifts line provenance tags accordingly.
   *
   * @param {string} uri - Document URI string
   * @param {{range: {start: {line: number}, end: {line: number}}, text: string}} change
   * @param {'typed' | 'pasted' | 'ai' | 'unknown'} origin
   * @param {number} [timestamp=Date.now()]
   */
  applyChange(uri, change, origin, timestamp = Date.now()) {
    const lines = this.getOrCreate(uri);
    const startLine = change.range.start.line;
    const endLine = change.range.end.line;

    // Expand array if startLine is beyond current bounds
    while (lines.length <= startLine) {
      lines.push({ origin: 'unknown', timestamp });
    }

    const linesRemoved = endLine - startLine;
    const textLines = change.text.split('\n');
    const linesAdded = textLines.length - 1;

    // Helper to determine origin for a line of inserted text (Phase 11)
    const resolveLineOrigin = (lineText) => {
      if (origin === 'ignore') return 'ignore';
      // If code was pasted or generated, any blank line within the pasted block receives 'ignore'
      if (change.text.trim().length > 0 && lineText !== undefined && lineText.trim().length === 0) {
        return 'ignore';
      }
      return origin;
    };

    if (linesAdded > linesRemoved) {
      // 1. Insertion: add (linesAdded - linesRemoved) new entries after startLine
      const countToInsert = linesAdded - linesRemoved;
      const newEntries = [];
      for (let i = 1; i <= countToInsert; i++) {
        const lineContent = textLines[i];
        newEntries.push({
          origin: resolveLineOrigin(lineContent),
          timestamp
        });
      }
      lines.splice(startLine + 1, 0, ...newEntries);

      // Also tag the affected starting line
      const startOrigin = (textLines[0].length === 0 && change.text.trim().length > 0)
        ? origin
        : resolveLineOrigin(textLines[0]);
      lines[startLine] = { origin: startOrigin, timestamp };
    } else if (linesAdded < linesRemoved) {
      // 2. Deletion: remove (linesRemoved - linesAdded) entries starting at startLine
      const countToRemove = linesRemoved - linesAdded;
      lines.splice(startLine, countToRemove);

      // If text was substituted during deletion, mark the remaining start line
      if (change.text.length > 0 && lines[startLine]) {
        lines[startLine] = { origin: resolveLineOrigin(textLines[0]), timestamp };
      }
    } else {
      // 3. Same line count (e.g. in-place typing or 1:1 replacement)
      for (let i = startLine; i <= startLine + linesAdded && i < lines.length; i++) {
        const lineIndexInChange = i - startLine;
        const lineContent = textLines[lineIndexInChange];
        lines[i] = { origin: resolveLineOrigin(lineContent), timestamp };
      }
    }

    return lines;
  }

  /**
   * Clears tracking for a closed document.
   * @param {string} uri
   */
  deleteDocument(uri) {
    this.documents.delete(uri);
  }
}

// Global singleton instance for the extension lifecycle
const defaultStore = new LineStore();

module.exports = {
  LineStore,
  defaultStore
};
