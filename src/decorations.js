let vscode;
try {
  vscode = require('vscode');
} catch {
  // Pure unit testing fallback
}

// Four whole-line background decoration types for provenance origins
const typedDecorationType = vscode ? vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(0,255,0,0.08)'
}) : null;

const pastedDecorationType = vscode ? vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(255,255,0,0.12)'
}) : null;

const aiDecorationType = vscode ? vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(0,150,255,0.12)'
}) : null;

// Phase 15: Solid purple decoration for deterministic AI-Native interception
const aiNativeDecorationType = vscode ? vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(168,85,247,0.18)'
}) : null;

const debounceTimers = new Map();
let statusBarItem = null;

function calculatePercentages(lines) {
  if (!lines || lines.length === 0) return 'Typed 0% | Pasted 0% | AI 0%';
  let typed = 0, pasted = 0, ai = 0, aiNative = 0;
  for (const line of lines) {
    if (line.origin === 'typed') typed++;
    else if (line.origin === 'pasted') pasted++;
    else if (line.origin === 'ai') ai++;
    else if (line.origin === 'ai-native') aiNative++;
  }
  // Phase 11: Meaningful Content Filter - lines tagged as 'ignore' or 'unknown' are excluded from denominator
  const meaningfulTotal = typed + pasted + ai + aiNative;
  if (meaningfulTotal === 0) return 'Typed 0% | Pasted 0% | AI 0%';

  const typedPct = Math.round((typed / meaningfulTotal) * 100);
  const pastedPct = Math.round((pasted / meaningfulTotal) * 100);
  const aiPct = Math.round((ai / meaningfulTotal) * 100);

  // Phase 15: Separate AI-Native tag in status bar when present
  if (aiNative > 0) {
    const aiNativePct = Math.round((aiNative / meaningfulTotal) * 100);
    return `Typed ${typedPct}% | Pasted ${pastedPct}% | AI ${aiPct}% | AI-Native ${aiNativePct}%`;
  }

  return `Typed ${typedPct}% | Pasted ${pastedPct}% | AI ${aiPct}%`;
}

function updateStatusBar(editor, store) {
  if (!statusBarItem) return;
  if (!editor || !editor.document) {
    statusBarItem.hide();
    return;
  }
  const lines = store.getLines(editor.document.uri.toString());
  statusBarItem.text = calculatePercentages(lines);
  statusBarItem.show();
}

function updateDecorations(editor, store, context) {
  if (!editor || !editor.document) return;
  const uri = editor.document.uri.toString();
  const isVisible = context.workspaceState.get('provenance.heatmapVisible', true);

  if (!isVisible) {
    editor.setDecorations(typedDecorationType, []);
    editor.setDecorations(pastedDecorationType, []);
    editor.setDecorations(aiDecorationType, []);
    if (aiNativeDecorationType) editor.setDecorations(aiNativeDecorationType, []);
    updateStatusBar(editor, store);
    return;
  }

  const lines = store.getLines(uri);
  const typedRanges = [];
  const pastedRanges = [];
  const aiRanges = [];
  const aiNativeRanges = [];

  for (let i = 0; i < lines.length && i < editor.document.lineCount; i++) {
    const range = new vscode.Range(i, 0, i, 0);
    const origin = lines[i].origin;
    if (origin === 'typed') typedRanges.push(range);
    else if (origin === 'pasted') pastedRanges.push(range);
    else if (origin === 'ai') aiRanges.push(range);
    else if (origin === 'ai-native') aiNativeRanges.push(range);
  }

  editor.setDecorations(typedDecorationType, typedRanges);
  editor.setDecorations(pastedDecorationType, pastedRanges);
  editor.setDecorations(aiDecorationType, aiRanges);
  if (aiNativeDecorationType) editor.setDecorations(aiNativeDecorationType, aiNativeRanges);
  updateStatusBar(editor, store);
}

function triggerDebouncedDecorations(editor, store, context) {
  if (!editor || !editor.document) return;
  const uri = editor.document.uri.toString();
  if (debounceTimers.has(uri)) {
    clearTimeout(debounceTimers.get(uri));
  }
  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    updateDecorations(editor, store, context);
  }, 150);
  debounceTimers.set(uri, timer);
}

function registerDecorations(context, store) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.name = 'Code Provenance Tracker';
  context.subscriptions.push(statusBarItem);

  if (context.workspaceState.get('provenance.heatmapVisible') === undefined) {
    context.workspaceState.update('provenance.heatmapVisible', true);
  }

  const toggleCmd = vscode.commands.registerCommand('provenance.toggleHeatmap', () => {
    const next = !context.workspaceState.get('provenance.heatmapVisible', true);
    context.workspaceState.update('provenance.heatmapVisible', next);
    if (vscode.window.activeTextEditor) {
      updateDecorations(vscode.window.activeTextEditor, store, context);
    }
    vscode.window.showInformationMessage(`Provenance Heatmap: ${next ? 'ON' : 'OFF'}`);
  });
  context.subscriptions.push(toggleCmd);

  const activeEditorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) updateDecorations(editor, store, context);
    else if (statusBarItem) statusBarItem.hide();
  });
  context.subscriptions.push(activeEditorSub);

  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor, store, context);
  }
}

module.exports = {
  typedDecorationType,
  pastedDecorationType,
  aiDecorationType,
  aiNativeDecorationType,
  registerDecorations,
  triggerDebouncedDecorations,
  updateDecorations,
  calculatePercentages
};
