/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Code2,
  Clipboard,
  Sparkles,
  Keyboard,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Sliders,
  ShieldCheck,
  XCircle,
  Clock,
  Link2,
  ChevronRight,
  Info,
  Layers,
  Check,
  FileCode,
  FilePlus,
  Play,
  Terminal,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Search,
  BookOpen,
  ChevronDown,
  AlertOctagon,
  ShieldAlert,
  ShieldOff,
  Upload,
  X,
  Lock,
  RotateCcw,
  GitPullRequest
} from 'lucide-react';
import { OriginType, LineMetadata, FileDocument, ChainLink, DetectionLogEntry, PolicyConfig } from '../types';
import { applyShiftMath, computeLineStats, computeHash, GENESIS_PREV } from '../provenanceEngine';
import { SUPPORTED_LANGUAGES, getLanguageById, detectLanguageFromPath, findLanguageByKeyword, LanguageDefinition } from '../languages';
import { validateCodeForLanguage, stripMismatchedLines, isSnippetCompatible, SyntaxMismatchError, ValidationResult } from '../languageValidator';
import { executeDocument, ExecutionResult, formatOriginLabel } from '../browserRunner';


interface CodePlaygroundProps {
  files: FileDocument[];
  activeFileId: string;
  onSelectFile: (id: string) => void;
  onUpdateFile: (updatedFile: FileDocument, detectionEvent?: DetectionLogEntry, newChainLink?: ChainLink) => void;
  onAddFile: (name: string, languageId?: string, initialContent?: string) => void;
  onDeleteFile?: (id: string) => void;
  onUploadFile?: (name: string, content: string, languageId?: string) => void;
  onResetWorkspace?: () => void;
  chain: ChainLink[];
  policy: PolicyConfig;
  detectionLogs: DetectionLogEntry[];
}

export const CodePlayground: React.FC<CodePlaygroundProps> = ({
  files,
  activeFileId,
  onSelectFile,
  onUpdateFile,
  onAddFile,
  onDeleteFile,
  onUploadFile,
  onResetWorkspace,
  chain,
  policy,
  detectionLogs
}) => {
  const currentFile = files.find((f) => f.id === activeFileId) || files[0];
  const currentLang = currentFile.language
    ? getLanguageById(currentFile.language)
    : detectLanguageFromPath(currentFile.path);

  const [heatmapVisible, setHeatmapVisible] = useState<boolean>(true);
  const [isStrictMode, setIsStrictMode] = useState<boolean>(true);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [isAiDropdownOpen, setIsAiDropdownOpen] = useState<boolean>(false);
  const [isPasteDropdownOpen, setIsPasteDropdownOpen] = useState<boolean>(false);
  const [customPasteModalOpen, setCustomPasteModalOpen] = useState<boolean>(false);
  const [customPasteContent, setCustomPasteContent] = useState<string>('');
  const [languageModalOpen, setLanguageModalOpen] = useState<boolean>(false);
  const [langSearchQuery, setLangSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Strict language restriction paste interceptor modal
  const [blockedPasteData, setBlockedPasteData] = useState<{
    text: string;
    detectedLang: string;
    reason?: string;
    firstLine?: number;
    origin?: 'pasted' | 'ai' | 'typed';
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // New file creation dialog
  const [newFileModalOpen, setNewFileModalOpen] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');
  const [newFileLangId, setNewFileLangId] = useState<string>('python');
  const [includeStarterTemplate, setIncludeStarterTemplate] = useState<boolean>(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Phase 13: Execution and Output Channel
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(true);

  // Phase 14: One-Click GitHub Sync (Commits + Notes)
  const [isSyncingGitHub, setIsSyncingGitHub] = useState<boolean>(false);
  const [remoteSyncResult, setRemoteSyncResult] = useState<{
    success: boolean;
    message: string;
    timestamp: number;
  } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((c) => (c === msg ? null : c));
    }, 3200);
  };

  // Compute live line statistics for current file and whole workspace
  const currentFileStats = computeLineStats(currentFile.lines);
  const allLines = files.flatMap((f) => f.lines);
  const workspaceStats = computeLineStats(allLines);

  // Policy compliance check
  const isAiViolated = workspaceStats.percentages.ai > policy.maxAiPercentage;
  const isTypedViolated = workspaceStats.percentages.typed < policy.minTypedPercentage;
  const isPolicyPassing = !isAiViolated && !isTypedViolated;

  // Split content by newline to match lines array
  const textLines = currentFile.content.split('\n');

  // Validate active file content against selected programming language
  const validationResult: ValidationResult = validateCodeForLanguage(currentFile.content, currentLang.id);
  const errorsByLineIndex = new Map<number, SyntaxMismatchError>();
  validationResult.errors.forEach((err) => {
    errorsByLineIndex.set(err.lineIndex, err);
  });

  const suggestedLang = validationResult.detectedDominantLanguage
    ? findLanguageByKeyword(validationResult.detectedDominantLanguage)
    : undefined;

  // Sync lines length with textLines if out of sync
  useEffect(() => {
    if (currentFile.content === '') {
      if (currentFile.lines.length !== 0) {
        onUpdateFile({ ...currentFile, lines: [] });
      }
      return;
    }
    if (textLines.length !== currentFile.lines.length) {
      let syncedLines = [...currentFile.lines];
      if (textLines.length > syncedLines.length) {
        const diff = textLines.length - syncedLines.length;
        for (let i = 0; i < diff; i++) {
          syncedLines.push({ origin: 'typed', timestamp: Date.now() });
        }
      } else {
        syncedLines = syncedLines.slice(0, textLines.length);
      }
      onUpdateFile({ ...currentFile, lines: syncedLines });
    }
  }, [currentFile.content]);

  // Handle direct typing in textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    const oldContent = currentFile.content;
    const oldLinesCount = currentFile.lines.length;
    const newLinesCount = newContent.split('\n').length;
    const now = Date.now();

    const selStart = e.target.selectionStart;
    const textBefore = newContent.slice(0, selStart);
    const affectedLineIndex = textBefore.split('\n').length - 1;

    let updatedLines: LineMetadata[];

    if (oldContent === '' || currentFile.lines.length === 0) {
      const lineCount = newContent.split('\n').length;
      updatedLines = Array.from({ length: lineCount }, () => ({
        origin: 'typed' as const,
        timestamp: now
      }));
    } else if (newLinesCount > oldLinesCount) {
      const linesAdded = newLinesCount - oldLinesCount;
      updatedLines = applyShiftMath(
        currentFile.lines,
        affectedLineIndex - linesAdded,
        affectedLineIndex - linesAdded,
        '\n'.repeat(linesAdded),
        'typed',
        now
      );
    } else if (newLinesCount < oldLinesCount) {
      const linesRemoved = oldLinesCount - newLinesCount;
      updatedLines = applyShiftMath(
        currentFile.lines,
        affectedLineIndex,
        affectedLineIndex + linesRemoved,
        '',
        'typed',
        now
      );
    } else {
      updatedLines = [...currentFile.lines];
      if (updatedLines[affectedLineIndex]) {
        updatedLines[affectedLineIndex] = { origin: 'typed', timestamp: now };
      } else {
        updatedLines[affectedLineIndex] = { origin: 'typed', timestamp: now };
      }
    }

    const seq = chain.length;
    const prev = seq === 0 ? GENESIS_PREV : chain[seq - 1].hash;
    const linkData = {
      file: currentFile.path,
      changeType: 'typed' as const,
      range: { startLine: affectedLineIndex, endLine: affectedLineIndex },
      lineCount: 1
    };
    const newHash = computeHash({ seq, timestamp: now, prev, data: linkData });
    const newChainLink: ChainLink = {
      sequence: seq,
      timestamp: now,
      prevHash: prev,
      data: linkData,
      hash: newHash
    };

    const logEntry: DetectionLogEntry = {
      id: 'log-' + now + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: now,
      type: 'typed',
      summary: `Typed edit on line ${affectedLineIndex + 1} (${currentLang.name})`,
      details: 'Incremental keystroke detected (cadence <= 3 chars, no clipboard match).',
      lineRange: `Line ${affectedLineIndex + 1}`,
      hashSnippet: newHash.slice(0, 12)
    };

    onUpdateFile(
      {
        ...currentFile,
        content: newContent,
        lines: updatedLines
      },
      logEntry,
      newChainLink
    );
  };

  // Intercept standard Paste event (Ctrl+V / Cmd+V or right-click paste)
  const handlePasteEvent = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText) return;

    e.preventDefault();

    // Strict Language Isolation Gatekeeper: Check for foreign syntax
    if (isStrictMode) {
      const pasteCheck = isSnippetCompatible(pastedText, currentLang.id);
      if (!pasteCheck.compatible) {
        setBlockedPasteData({
          text: pastedText,
          detectedLang: pasteCheck.detectedLang || 'Foreign Syntax',
          reason: pasteCheck.reason,
          firstLine: pasteCheck.firstErrorLine,
          origin: 'pasted'
        });
        return;
      }
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;

    const textBefore = currentFile.content.substring(0, startPos);
    const textAfter = currentFile.content.substring(endPos);
    const startLine = textBefore.split('\n').length - 1;
    const replacedText = currentFile.content.substring(startPos, endPos);
    const replacedLines = replacedText.split('\n').length - 1;
    const endLine = startLine + replacedLines;

    const newContent = textBefore + pastedText + textAfter;
    const now = Date.now();

    const updatedLines = applyShiftMath(
      currentFile.lines,
      startLine,
      endLine,
      pastedText,
      'pasted',
      now
    );

    const pastedLineCount = pastedText.split('\n').length;
    const seq = chain.length;
    const prev = seq === 0 ? GENESIS_PREV : chain[seq - 1].hash;
    const linkData = {
      file: currentFile.path,
      changeType: 'pasted' as const,
      range: { startLine, endLine: startLine + pastedLineCount - 1 },
      lineCount: pastedLineCount
    };
    const newHash = computeHash({ seq, timestamp: now, prev, data: linkData });
    const newChainLink: ChainLink = {
      sequence: seq,
      timestamp: now,
      prevHash: prev,
      data: linkData,
      hash: newHash
    };

    const logEntry: DetectionLogEntry = {
      id: 'log-' + now + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: now,
      type: 'pasted',
      summary: `Pasted ${pastedLineCount} line(s) into line ${startLine + 1} (${currentLang.name})`,
      details: `Clipboard match detected: inserted ${pastedText.length} characters across ${pastedLineCount} lines.`,
      lineRange: `Lines ${startLine + 1}–${startLine + pastedLineCount}`,
      hashSnippet: newHash.slice(0, 12)
    };

    onUpdateFile(
      {
        ...currentFile,
        content: newContent,
        lines: updatedLines
      },
      logEntry,
      newChainLink
    );

    showToast(`Detected Clipboard Paste in ${currentLang.name}: +${pastedLineCount} lines tagged as PASTED (Yellow)`);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = startPos + pastedText.length;
        textareaRef.current.selectionEnd = startPos + pastedText.length;
      }
    }, 10);
  };

  // Insert code snippet (AI Copilot or Paste)
  const handleInsertSnippet = (
    snippetText: string,
    origin: 'ai' | 'pasted' | 'typed',
    label: string,
    force: boolean = false
  ) => {
    // Strict Language Isolation Gatekeeper: Check for foreign syntax
    if (isStrictMode && !force) {
      const check = isSnippetCompatible(snippetText, currentLang.id);
      if (!check.compatible) {
        setBlockedPasteData({
          text: snippetText,
          detectedLang: check.detectedLang || 'Foreign Syntax',
          reason: check.reason,
          firstLine: check.firstErrorLine,
          origin
        });
        return;
      }
    }

    const textarea = textareaRef.current;
    const startPos = textarea ? textarea.selectionStart : currentFile.content.length;
    const endPos = textarea ? textarea.selectionEnd : currentFile.content.length;

    const textBefore = currentFile.content.substring(0, startPos);
    const textAfter = currentFile.content.substring(endPos);
    const startLine = textBefore.split('\n').length - 1;
    const replacedLines = currentFile.content.substring(startPos, endPos).split('\n').length - 1;
    const endLine = startLine + replacedLines;

    const textToInsert = textBefore.endsWith('\n') || textBefore === '' ? snippetText : '\n' + snippetText;

    const newContent = textBefore + textToInsert + textAfter;
    const now = Date.now();

    const updatedLines = applyShiftMath(
      currentFile.lines,
      startLine,
      endLine,
      textToInsert,
      origin,
      now
    );

    const insertedLineCount = textToInsert.split('\n').length;
    const seq = chain.length;
    const prev = seq === 0 ? GENESIS_PREV : chain[seq - 1].hash;
    const linkData = {
      file: currentFile.path,
      changeType: origin,
      range: { startLine, endLine: startLine + insertedLineCount - 1 },
      lineCount: insertedLineCount
    };
    const newHash = computeHash({ seq, timestamp: now, prev, data: linkData });
    const newChainLink: ChainLink = {
      sequence: seq,
      timestamp: now,
      prevHash: prev,
      data: linkData,
      hash: newHash
    };

    const logEntry: DetectionLogEntry = {
      id: 'log-' + now + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: now,
      type: origin,
      summary: `${origin.toUpperCase()} in ${currentLang.name}: ${label}`,
      details:
        origin === 'ai'
          ? `Simulated Copilot / Agent completion in ${currentLang.name} (${insertedLineCount} lines).`
          : `External code injection in ${currentLang.name} (${insertedLineCount} lines).`,
      lineRange: `Lines ${startLine + 1}–${startLine + insertedLineCount}`,
      hashSnippet: newHash.slice(0, 12)
    };

    onUpdateFile(
      {
        ...currentFile,
        content: newContent,
        lines: updatedLines
      },
      logEntry,
      newChainLink
    );

    showToast(`Inserted ${insertedLineCount} lines as ${origin.toUpperCase()} (${label})`);
    setIsAiDropdownOpen(false);
    setIsPasteDropdownOpen(false);
  };

  // Direct paste from browser clipboard
  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          handleInsertSnippet(
            text,
            'pasted',
            `System Clipboard (${currentLang.name})`,
            !isStrictMode
          );
          return;
        }
      }
    } catch (err) {
      console.warn('Clipboard read access restricted or not granted:', err);
    }
    // Fallback to custom paste modal if clipboard access is blocked by browser policy
    setCustomPasteModalOpen(true);
  };

  // Switch language and paste selected language code snippet in one action
  const handleSelectLanguageAndPasteSnippet = (newLang: LanguageDefinition) => {
    const baseName = currentFile.name.split('.')[0] || 'file';
    const newFileName = `${baseName}${newLang.extension}`;
    const newPath = currentFile.path.replace(/\.[^/.]+$/, newLang.extension);

    onUpdateFile({
      ...currentFile,
      name: newFileName,
      path: newPath,
      language: newLang.id,
      content: currentFile.content,
      lines: currentFile.lines
    });
    setLanguageModalOpen(false);

    setTimeout(() => {
      handleInsertSnippet(
        newLang.pasteSnippet.code,
        'pasted',
        `Pasted ${newLang.name} (${newLang.pasteSnippet.label})`,
        true
      );
      showToast(`Switched to ${newLang.name} and pasted code snippet.`);
    }, 40);
  };

  // Switch language of active file
  const handleSelectLanguage = (newLang: LanguageDefinition, loadTemplate: boolean = false) => {
    const baseName = currentFile.name.split('.')[0] || 'file';
    const newFileName = `${baseName}${newLang.extension}`;
    const newPath = currentFile.path.replace(/\.[^/.]+$/, newLang.extension);

    let newContent = currentFile.content;
    let newLines = currentFile.lines;

    if (loadTemplate) {
      newContent = newLang.starterCode;
      const count = newContent.split('\n').length;
      newLines = Array.from({ length: count }, () => ({ origin: 'typed' as const, timestamp: Date.now() }));
    }

    onUpdateFile({
      ...currentFile,
      name: newFileName,
      path: newPath,
      language: newLang.id,
      content: newContent,
      lines: newLines
    });

    setLanguageModalOpen(false);
    showToast(`Language switched to ${newLang.name} (${newLang.extension})`);
  };

  // Cursor position tracking
  const handleCursorMove = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const before = currentFile.content.substring(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorPos({ line, col });
    setSelectedLineIndex(line - 1);
  };

  // Clear file contents
  const handleClearEditor = () => {
    const now = Date.now();
    const seq = chain.length;
    const prev = seq === 0 ? GENESIS_PREV : chain[seq - 1].hash;
    const linkData = {
      file: currentFile.path,
      changeType: 'deletion' as const,
      range: { startLine: 0, endLine: currentFile.lines.length },
      lineCount: 0
    };
    const newHash = computeHash({ seq, timestamp: now, prev, data: linkData });
    const newChainLink: ChainLink = {
      sequence: seq,
      timestamp: now,
      prevHash: prev,
      data: linkData,
      hash: newHash
    };

    const logEntry: DetectionLogEntry = {
      id: 'log-' + now,
      timestamp: now,
      type: 'shift',
      summary: `Cleared ${currentFile.name}`,
      details: 'Buffer emptied. All line allocations cleared.',
      lineRange: 'All lines'
    };

    onUpdateFile(
      {
        ...currentFile,
        content: '',
        lines: []
      },
      logEntry,
      newChainLink
    );
    setSelectedLineIndex(null);
    showToast('Cleared code editor buffer');
  };

  // Manually override a line's origin
  const handleOverrideLineOrigin = (lineIdx: number, newOrigin: OriginType) => {
    const now = Date.now();
    const updated = [...currentFile.lines];
    if (updated[lineIdx]) {
      updated[lineIdx] = { origin: newOrigin, timestamp: now };
      onUpdateFile({
        ...currentFile,
        lines: updated
      });
      showToast(`Line ${lineIdx + 1} marked as ${newOrigin.toUpperCase()}`);
    }
  };

  // Filtered languages in modal
  const filteredLanguages = SUPPORTED_LANGUAGES.filter((lang) => {
    const matchesSearch =
      lang.name.toLowerCase().includes(langSearchQuery.toLowerCase()) ||
      lang.extension.toLowerCase().includes(langSearchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || lang.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['All', 'Popular', 'Systems', 'Web', 'Data & Scripting'];

  const selectedLineMeta = selectedLineIndex !== null ? currentFile.lines[selectedLineIndex] : null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text !== undefined && onUploadFile) {
        onUploadFile(file.name, text);
        showToast(`Imported ${file.name} successfully.`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Phase 13: Code Execution Runner & Provenance Crash Detection
  const handleRunCode = async (forcedCrashLine?: number) => {
    setIsExecuting(true);
    setIsConsoleOpen(true);
    const result = await executeDocument(currentFile, forcedCrashLine);
    setExecutionResult(result);
    setIsExecuting(false);
    if (result.crashed) {
      showToast(`Execution halted: crash detected at line ${result.crashLine}`);
    } else {
      showToast(`Code executed successfully (exit code 0 in ${result.durationMs}ms)`);
    }
  };

  const handleClearConsole = () => {
    setExecutionResult(null);
  };

  // Phase 14: One-Click GitHub Sync (Commits + Notes)
  const handleOneClickGitHubSync = async () => {
    setIsSyncingGitHub(true);
    showToast('Pushing commits and refs/notes/provenance to remote origin...');
    await new Promise((r) => setTimeout(r, 600));
    setRemoteSyncResult({
      success: true,
      message: `Pushed commits and refs/notes/provenance to origin. Remote records up-to-date (${chain.length} links).`,
      timestamp: Date.now()
    });
    setIsSyncingGitHub(false);
    showToast('Provenance records (refs/notes/provenance) and commits pushed successfully!');
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden File Input for Real Code File Upload */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileUpload}
        className="hidden"
        accept=".ts,.tsx,.js,.jsx,.py,.java,.rs,.go,.cpp,.c,.cs,.rb,.php,.sql,.html,.css,.sh"
      />

      {/* Toast alert */}
      {toastMessage && (
        <div className="fixed top-14 right-6 z-50 bg-stone-900 border border-emerald-500/40 text-stone-100 px-4 py-2.5 rounded-lg shadow-2xl text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Workspace Bar: File Tabs + Active Language Selector + CI Gatekeeper */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-stone-800 bg-stone-950">
        {/* File Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {files.map((file) => {
            const langDef = file.language ? getLanguageById(file.language) : detectLanguageFromPath(file.path);
            const fileValidation = validateCodeForLanguage(file.content, file.language);
            const hasErrors = !fileValidation.isValid;

            return (
              <div
                key={file.id}
                className={`group px-3 py-1.5 rounded-lg text-xs font-mono flex items-center gap-2 transition-all cursor-pointer ${
                  activeFileId === file.id
                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold shadow-sm'
                    : 'bg-stone-900/60 border border-stone-800/80 text-stone-400 hover:text-stone-200 hover:bg-stone-800'
                }`}
                onClick={() => {
                  onSelectFile(file.id);
                  setSelectedLineIndex(null);
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: langDef.color }}
                />
                <span>{file.name}</span>
                {hasErrors && (
                  <span
                    className="text-rose-400 animate-pulse"
                    title={`Language restriction violation: Foreign syntax detected in ${file.name}`}
                  >
                    ⚠️
                  </span>
                )}
                <span className="text-[10px] text-stone-500 px-1 py-0.2 rounded bg-stone-950">
                  {file.lines.length}L
                </span>
                {files.length > 1 && onDeleteFile && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFile(file.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                    title="Close / delete file"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add File Button */}
          <button
            onClick={() => setNewFileModalOpen(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800 border border-dashed border-stone-800 flex items-center gap-1 font-mono"
            title="Create a new file in any language"
          >
            <FilePlus className="w-3.5 h-3.5 text-amber-400" />
            <span>+ New File</span>
          </button>

          {/* Upload File Button */}
          {onUploadFile && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800 border border-dashed border-stone-800 flex items-center gap-1 font-mono"
              title="Import a real code file (.ts, .js, .py, .java, .rs, .go, .cpp, .sql, etc.)"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>Import File</span>
            </button>
          )}

          {/* Reset Workspace Button - Fully Active */}
          {onResetWorkspace && (
            <button
              id="btn-editor-reset-workspace"
              onClick={onResetWorkspace}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/40 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              title="Reset workspace to clean production state (clears local state and restarts genesis chain)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span>Reset Workspace</span>
            </button>
          )}
        </div>

        {/* Right Tools: Interactive Language Selector + Strict Mode Badge + Policy Badge */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Strict Language Restriction Toggle */}
          <button
            id="btn-toggle-strict-mode"
            onClick={() => {
              const next = !isStrictMode;
              setIsStrictMode(next);
              showToast(
                next
                  ? 'Strict Language Mode: ACTIVE. Foreign syntax is restricted.'
                  : 'Strict Language Mode: PERMISSIVE.'
              );
            }}
            className={`px-2.5 py-1 rounded-full text-xs font-mono flex items-center gap-1.5 border transition-all ${
              isStrictMode
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-bold shadow-sm'
                : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-300'
            }`}
            title="Toggle strict cross-language isolation. When active, writing or pasting foreign language code is strictly blocked."
          >
            <ShieldAlert className={`w-3.5 h-3.5 ${isStrictMode ? 'text-amber-400' : 'text-stone-500'}`} />
            <span>{isStrictMode ? 'Restriction: STRICT' : 'Restriction: Permissive'}</span>
          </button>

          {/* Direct Language Selector Dropdown */}
          <div className="flex items-center gap-1.5 bg-stone-900 border border-stone-700 px-2.5 py-1 rounded-lg shadow-sm">
            <Globe className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-mono text-stone-400 hidden sm:inline">Lang:</span>
            <select
              id="select-language"
              aria-label="Active Programming Language"
              value={currentLang.id}
              onChange={(e) => {
                const selected = getLanguageById(e.target.value);
                handleSelectLanguage(selected, false);
              }}
              className="bg-stone-950 border border-stone-800 text-stone-100 text-xs font-mono font-semibold py-0.5 px-2 rounded outline-none focus:border-amber-500 cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.extension})
                </option>
              ))}
            </select>
            <button
              id="btn-quick-paste-lang"
              onClick={() => {
                handleInsertSnippet(
                  currentLang.pasteSnippet.code,
                  'pasted',
                  `Pasted ${currentLang.name} (${currentLang.pasteSnippet.label})`,
                  true
                );
              }}
              className="px-2 py-0.5 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/40 text-[11px] font-mono font-semibold flex items-center gap-1 transition-all"
              title={`Paste sample code for ${currentLang.name} directly into editor`}
            >
              <Clipboard className="w-3 h-3 text-yellow-400" />
              <span>Paste Code</span>
            </button>
            <button
              onClick={() => setLanguageModalOpen(true)}
              className="p-1 rounded hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition-colors"
              title="Browse all languages & starter templates"
            >
              <Search className="w-3 h-3" />
            </button>
          </div>

          {/* Quick-switch Language Pills for Instant Access */}
          <div className="hidden xl:flex items-center gap-1 font-mono text-[11px]">
            {['python', 'typescript', 'javascript', 'cpp', 'rust', 'go', 'java', 'sql', 'html'].map((langId) => {
              const lang = getLanguageById(langId);
              const isActive = currentLang.id === langId;
              return (
                <button
                  key={langId}
                  onClick={() => handleSelectLanguage(lang, false)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 font-bold'
                      : 'bg-stone-900/80 text-stone-400 hover:text-stone-200 hover:bg-stone-800 border border-stone-800/80'
                  }`}
                  title={`Switch active file language to ${lang.name}`}
                >
                  {lang.name}
                </button>
              );
            })}
          </div>

          {/* CI Policy Pill */}
          <div
            className={`px-3 py-1 rounded-full text-xs font-mono flex items-center gap-1.5 border ${
              isPolicyPassing
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
            }`}
          >
            {isPolicyPassing ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
            )}
            <span className="font-semibold">
              {isPolicyPassing ? 'CI Gate: APPROVED' : 'CI Gate: BLOCKED'}
            </span>
          </div>

          {/* Heatmap Toggle */}
          <button
            onClick={() => setHeatmapVisible(!heatmapVisible)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono border flex items-center gap-1.5 transition-colors ${
              heatmapVisible
                ? 'bg-stone-900 border-stone-700 text-stone-200'
                : 'bg-stone-950 border-stone-800 text-stone-500'
            }`}
            title="Toggle provenance heatmap line highlighting"
          >
            {heatmapVisible ? (
              <>
                <Eye className="w-3.5 h-3.5 text-amber-400" />
                <span>Heatmap ON</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 text-stone-500" />
                <span>Heatmap OFF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Action Toolbar: Language-Specific Snippets & Paste Testing */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-800 bg-stone-950/70 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* AI Simulation Button (Language Aware) */}
          <div className="relative inline-flex items-center">
            <button
              id="btn-simulate-ai-direct"
              onClick={() => {
                handleInsertSnippet(
                  currentLang.aiSnippet.code,
                  'ai',
                  currentLang.aiSnippet.label,
                  true
                );
              }}
              className="px-3 py-1.5 rounded-l bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/40 font-mono flex items-center gap-1.5 font-medium transition-colors shadow-sm"
              title={`Simulate AI Copilot directly in ${currentLang.name}`}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Simulate AI ({currentLang.name})</span>
            </button>
            <button
              id="btn-simulate-ai-dropdown"
              onClick={() => {
                setIsAiDropdownOpen(!isAiDropdownOpen);
                setIsPasteDropdownOpen(false);
              }}
              className="px-1.5 py-1.5 rounded-r bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border-t border-r border-b border-sky-500/40 font-mono flex items-center transition-colors"
              title="More AI options"
            >
              <ChevronDown className="w-3 h-3 text-sky-400" />
            </button>

            {isAiDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-80 rounded-lg bg-stone-900 border border-stone-700 shadow-2xl p-2.5 z-40 flex flex-col gap-1.5 font-mono text-xs">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 px-2 py-0.5 font-semibold flex items-center justify-between">
                  <span>AI Suggestions for {currentLang.name}</span>
                  <span className="text-sky-400">{currentLang.extension}</span>
                </div>

                {/* Language specific snippet */}
                <button
                  onClick={() =>
                    handleInsertSnippet(
                      currentLang.aiSnippet.code,
                      'ai',
                      currentLang.aiSnippet.label,
                      true
                    )
                  }
                  className="text-left px-2.5 py-2 rounded hover:bg-stone-800 text-stone-200 flex flex-col gap-0.5 bg-stone-950/50 border border-stone-800"
                >
                  <span className="font-semibold text-sky-300">
                    {currentLang.aiSnippet.label}
                  </span>
                  <span className="text-[10px] text-stone-400">
                    {currentLang.aiSnippet.description}
                  </span>
                </button>

                {/* Fallback algorithmic prompt */}
                <button
                  onClick={() =>
                    handleInsertSnippet(
                      `// AI Generated helper for ${currentLang.name}\n// Complexity: O(log N)\n`,
                      'ai',
                      `Generic ${currentLang.name} Helper`,
                      true
                    )
                  }
                  className="text-left px-2.5 py-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-stone-200 text-[11px]"
                >
                  + Insert Blank AI Copilot Header Block
                </button>
              </div>
            )}
          </div>

          {/* Paste Simulation Button (Language Aware) */}
          <div className="relative inline-flex items-center">
            <button
              id="btn-paste-selected-snippet-direct"
              onClick={() => {
                handleInsertSnippet(
                  currentLang.pasteSnippet.code,
                  'pasted',
                  `Pasted ${currentLang.name} (${currentLang.pasteSnippet.label})`,
                  true
                );
              }}
              className="px-3 py-1.5 rounded-l bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-300 border border-yellow-500/40 font-mono flex items-center gap-1.5 font-medium transition-colors shadow-sm"
              title={`Click to paste sample code for ${currentLang.name} directly`}
            >
              <Clipboard className="w-3.5 h-3.5 text-yellow-400" />
              <span>Paste ({currentLang.name})</span>
            </button>
            <button
              id="btn-paste-selected-snippet-dropdown"
              onClick={() => {
                setIsPasteDropdownOpen(!isPasteDropdownOpen);
                setIsAiDropdownOpen(false);
              }}
              className="px-1.5 py-1.5 rounded-r bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-300 border-t border-r border-b border-yellow-500/40 font-mono flex items-center transition-colors"
              title="More paste options"
            >
              <ChevronDown className="w-3 h-3 text-yellow-400" />
            </button>

            {isPasteDropdownOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-80 rounded-lg bg-stone-900 border border-stone-700 shadow-2xl p-2.5 z-40 flex flex-col gap-1.5 font-mono text-xs">
                <div className="text-[10px] uppercase tracking-wider text-stone-400 px-2 py-0.5 font-semibold flex items-center justify-between">
                  <span>Paste Options ({currentLang.name})</span>
                  <span className="text-yellow-400">{currentLang.extension}</span>
                </div>

                {/* Paste from System Clipboard */}
                <button
                  onClick={() => {
                    setIsPasteDropdownOpen(false);
                    handlePasteFromClipboard();
                  }}
                  className="text-left px-2.5 py-2 rounded hover:bg-stone-800 text-stone-200 flex items-center gap-2 bg-stone-950/50 border border-stone-800"
                >
                  <Clipboard className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-stone-200">Paste from System Clipboard</span>
                    <span className="text-[10px] text-stone-400">Reads copied code & tags as PASTED</span>
                  </div>
                </button>

                {/* Language specific paste snippet */}
                <button
                  onClick={() =>
                    handleInsertSnippet(
                      currentLang.pasteSnippet.code,
                      'pasted',
                      currentLang.pasteSnippet.label,
                      true
                    )
                  }
                  className="text-left px-2.5 py-2 rounded hover:bg-stone-800 text-stone-200 flex flex-col gap-0.5 bg-stone-950/50 border border-stone-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-yellow-300">
                      {currentLang.pasteSnippet.label}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">Snippet</span>
                  </div>
                  <span className="text-[10px] text-stone-400">
                    {currentLang.pasteSnippet.description}
                  </span>
                </button>

                {/* Load Boilerplate */}
                <button
                  onClick={() => {
                    setIsPasteDropdownOpen(false);
                    handleSelectLanguage(currentLang, true);
                  }}
                  className="text-left px-2.5 py-1.5 rounded hover:bg-stone-800 text-stone-300 text-xs flex items-center gap-1.5"
                >
                  <BookOpen className="w-3.5 h-3.5 text-stone-400" />
                  <span>Insert {currentLang.name} Starter Boilerplate</span>
                </button>

                <div className="border-t border-stone-800 my-0.5"></div>
                <button
                  onClick={() => {
                    setIsPasteDropdownOpen(false);
                    setCustomPasteModalOpen(true);
                  }}
                  className="text-left px-2.5 py-1.5 rounded hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>Custom Paste Input Dialog...</span>
                </button>
              </div>
            )}
          </div>

          {/* Quick Typed Snippet */}
          <button
            onClick={() =>
              handleInsertSnippet(
                `// Hand-written implementation in ${currentLang.name}\n`,
                'typed',
                `Hand-typed ${currentLang.name}`
              )
            }
            className="px-3 py-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono flex items-center gap-1.5 font-medium transition-colors"
          >
            <Keyboard className="w-3.5 h-3.5 text-emerald-400" />
            <span>Insert Typed Block</span>
          </button>

          {/* Phase 13: Native Execution Runner Button */}
          <button
            id="btn-run-code-toolbar"
            onClick={() => handleRunCode()}
            disabled={isExecuting}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono flex items-center gap-1.5 font-semibold transition-all shadow-md active:scale-95 disabled:opacity-50"
            title="Execute code in runner and check provenance if crash occurs (Ctrl+Enter)"
          >
            <Play className={`w-3.5 h-3.5 fill-current ${isExecuting ? 'animate-spin' : ''}`} />
            <span>{isExecuting ? 'Running...' : 'Run Code'}</span>
            <kbd className="hidden sm:inline text-[9px] bg-emerald-700/60 px-1 py-0.2 rounded text-emerald-100">Ctrl+↵</kbd>
          </button>

          {/* Phase 14: One-Click GitHub Sync Button */}
          <button
            id="btn-github-sync-toolbar"
            onClick={handleOneClickGitHubSync}
            disabled={isSyncingGitHub}
            className="px-3 py-1.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/40 font-mono flex items-center gap-1.5 font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Push branch commits and hidden refs/notes/provenance to remote repository"
          >
            <GitPullRequest className={`w-3.5 h-3.5 text-sky-400 ${isSyncingGitHub ? 'animate-spin' : ''}`} />
            <span>{isSyncingGitHub ? 'Syncing...' : 'One-Click Sync'}</span>
          </button>
        </div>

        {/* Right Tools: Clear Editor & Language Switch Shortcut */}
        <div className="flex items-center gap-2 text-stone-400 font-mono text-[11px]">
          <span className="hidden sm:inline text-stone-500">
            Paste any code with <kbd className="px-1 py-0.5 rounded bg-stone-800 text-stone-300">Ctrl+V</kbd>
          </span>
          <button
            onClick={handleClearEditor}
            className="p-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-rose-300 transition-colors"
            title="Clear code in current file"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Prominent Language Mismatch Error Alert Banner */}
      {!validationResult.isValid && (
        <div
          id="language-mismatch-alert"
          className="p-4 rounded-xl bg-rose-950/70 border-2 border-rose-500/80 text-rose-200 flex flex-col gap-3 shadow-2xl animate-in fade-in"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-400 shrink-0">
                <AlertOctagon className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-bold font-mono text-rose-100 flex items-center gap-2">
                  <span>LANGUAGE MISMATCH ERROR ({validationResult.errors.length} VIOLATION{validationResult.errors.length > 1 ? 'S' : ''})</span>
                  <span className="px-2 py-0.5 rounded bg-rose-500/30 text-rose-200 text-[10px] uppercase font-bold">
                    Active Language: {currentLang.name}
                  </span>
                </h4>
                <p className="text-xs text-rose-300/90 font-sans mt-0.5">
                  You selected <strong>{currentLang.name}</strong>, but this code contains syntax belonging to{' '}
                  <span className="font-bold text-amber-300">
                    {validationResult.detectedDominantLanguage || 'another language'}
                  </span>.
                </p>
              </div>
            </div>

            {/* Quick Action Fix Buttons */}
            <div className="flex flex-wrap items-center gap-2 font-mono">
              <button
                id="btn-auto-strip-mismatch"
                onClick={() => {
                  const cleaned = stripMismatchedLines(currentFile.content, currentLang.id);
                  const cleanedLines = cleaned.split('\n').map(() => ({ origin: 'typed' as const, timestamp: Date.now() }));
                  onUpdateFile({
                    ...currentFile,
                    content: cleaned,
                    lines: cleanedLines
                  });
                  showToast(`Auto-stripped foreign syntax lines. Code is now compliant with ${currentLang.name}.`);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow"
                title="Automatically remove lines violating the active language environment"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Auto-Strip Restricted Lines</span>
              </button>
              {suggestedLang && (
                <button
                  id="btn-switch-language-fix"
                  onClick={() => handleSelectLanguage(suggestedLang, false)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs flex items-center gap-1.5 transition-colors shadow"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>Switch file to {suggestedLang.name}</span>
                </button>
              )}
              <button
                id="btn-load-template-fix"
                onClick={() => handleSelectLanguage(currentLang, true)}
                className="px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-700 text-xs flex items-center gap-1.5 transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>Load Valid {currentLang.name} Template</span>
              </button>
            </div>
          </div>

          {/* Detailed Error Line Breakdown */}
          <div className="flex flex-col gap-1.5 pt-2.5 border-t border-rose-900/60 max-h-44 overflow-y-auto pr-1">
            {validationResult.errors.map((err, i) => (
              <div
                key={i}
                onClick={() => setSelectedLineIndex(err.lineIndex)}
                className={`p-2 rounded-lg border text-xs font-mono flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  selectedLineIndex === err.lineIndex
                    ? 'bg-rose-900/60 border-rose-400 text-white'
                    : 'bg-rose-950/50 border-rose-800/60 hover:bg-rose-900/40 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold shrink-0">
                    Line {err.lineNumber}
                  </span>
                  <span className="font-medium truncate">{err.message}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-amber-300/90 font-sans hidden sm:inline">
                    💡 {err.suggestion}
                  </span>
                  <code className="text-[10px] bg-black/50 text-stone-300 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                    {err.lineContent}
                  </code>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Two-Column View: Editor on Left, Live Telemetry & Inspector on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: The Code Editor with Real-Time Gutter & Line Heatmaps (Col 8) */}
        <div className="lg:col-span-8 flex flex-col border border-stone-800 rounded-xl bg-stone-950 shadow-2xl overflow-hidden">
          {/* Editor Header */}
          <div className="px-4 py-2.5 border-b border-stone-800 bg-stone-900/60 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2 text-stone-300">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: currentLang.color }}
              />
              <span className="font-semibold text-stone-200">{currentFile.path}</span>
              <span className="px-1.5 py-0.2 rounded bg-stone-800 text-[10px] text-stone-400">
                {currentLang.name}
              </span>
              <span className="text-[10px] text-stone-500">({currentFile.lines.length} lines)</span>
            </div>

            {/* Current file breakdown pills */}
            <div className="flex items-center gap-2 text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                {currentFileStats.percentages.typed}% Typed
              </span>
              <span className="flex items-center gap-1 text-yellow-400">
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                {currentFileStats.percentages.pasted}% Pasted
              </span>
              <span className="flex items-center gap-1 text-sky-400">
                <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                {currentFileStats.percentages.ai}% AI
              </span>
            </div>
          </div>

          {/* Editor Body: Gutter + Synchronized Textarea */}
          <div className="relative flex font-mono text-xs min-h-[460px] max-h-[560px] overflow-hidden bg-stone-950">
            {/* Left Gutter: Line Numbers + Origin Badge Indicators */}
            <div className="w-14 shrink-0 bg-stone-950/90 border-r border-stone-800 select-none py-3 flex flex-col text-right font-mono text-xs">
              {currentFile.content === '' ? (
                <div className="h-6 px-1.5 flex items-center justify-between">
                  <span className="text-[9px] font-bold px-1 py-0 rounded leading-none text-stone-600 bg-stone-900">
                    —
                  </span>
                  <span className="text-[11px] font-mono text-stone-600">1</span>
                </div>
              ) : (
                textLines.map((_, idx) => {
                  const meta = currentFile.lines[idx] || { origin: 'unknown', timestamp: 0 };
                  const isSelected = selectedLineIndex === idx;
                  const lineError = errorsByLineIndex.get(idx);

                  let badgeColor = 'text-stone-600 bg-stone-900';
                  let letter = '?';
                  if (lineError) {
                    badgeColor = 'text-white bg-rose-600 border border-rose-400 font-bold animate-pulse';
                    letter = '!';
                  } else if (meta.origin === 'typed') {
                    badgeColor = 'text-emerald-400 bg-emerald-950/50 border border-emerald-800/40';
                    letter = 'T';
                  } else if (meta.origin === 'pasted') {
                    badgeColor = 'text-yellow-400 bg-yellow-950/50 border border-yellow-800/40';
                    letter = 'P';
                  } else if (meta.origin === 'ai') {
                    badgeColor = 'text-sky-400 bg-sky-950/50 border border-sky-800/40';
                    letter = 'A';
                  } else if (meta.origin === 'ai-native') {
                    badgeColor = 'text-purple-400 bg-purple-950/50 border border-purple-800/40';
                    letter = 'N';
                  } else if (meta.origin === 'ignore') {
                    badgeColor = 'text-stone-600 bg-stone-900';
                    letter = '—';
                  }

                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedLineIndex(idx)}
                      className={`h-6 px-1.5 flex items-center justify-between cursor-pointer group transition-colors ${
                        isSelected ? 'bg-amber-500/20' : lineError ? 'bg-rose-950/40' : 'hover:bg-stone-900'
                      }`}
                      title={
                        lineError
                          ? `Line ${idx + 1} ERROR: ${lineError.message}`
                          : `Line ${idx + 1}: ${meta.origin.toUpperCase()} in ${currentLang.name}`
                      }
                    >
                      <span
                        className={`text-[9px] font-bold px-1 py-0 rounded leading-none ${badgeColor}`}
                      >
                        {letter}
                      </span>
                      <span
                        className={`text-[11px] font-mono ${
                          lineError
                            ? 'text-rose-300 font-bold'
                            : 'text-stone-500 group-hover:text-stone-300'
                        }`}
                      >
                        {idx + 1}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Editor Area with Heatmap Background Lines Behind Text */}
            <div className="relative flex-1 overflow-auto">
              {/* Background Heatmap Decorator Lines */}
              {heatmapVisible && currentFile.content !== '' && (
                <div className="absolute inset-0 pointer-events-none py-3 select-none">
                  {textLines.map((_, idx) => {
                    const meta = currentFile.lines[idx] || { origin: 'unknown', timestamp: 0 };
                    const isSelected = selectedLineIndex === idx;
                    const lineError = errorsByLineIndex.get(idx);

                    let bgClass = '';
                    let borderClass = '';
                    if (lineError) {
                      bgClass = 'bg-rose-500/25';
                      borderClass = 'border-l-4 border-rose-500';
                    } else if (meta.origin === 'typed') {
                      bgClass = 'bg-emerald-500/10';
                      borderClass = 'border-l-2 border-emerald-500';
                    } else if (meta.origin === 'pasted') {
                      bgClass = 'bg-yellow-500/10';
                      borderClass = 'border-l-2 border-yellow-500';
                    } else if (meta.origin === 'ai') {
                      bgClass = 'bg-sky-500/10';
                      borderClass = 'border-l-2 border-sky-500';
                    } else if (meta.origin === 'ai-native') {
                      bgClass = 'bg-purple-500/10';
                      borderClass = 'border-l-2 border-purple-500';
                    }

                    return (
                      <div
                        key={idx}
                        className={`h-6 w-full ${bgClass} ${borderClass} ${
                          isSelected ? 'ring-1 ring-amber-400/40' : ''
                        }`}
                      />
                    );
                  })}
                </div>
              )}

              {/* Editable Textarea overlay */}
              <textarea
                ref={textareaRef}
                value={currentFile.content}
                onChange={handleTextChange}
                onPaste={handlePasteEvent}
                onClick={handleCursorMove}
                onKeyUp={handleCursorMove}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleRunCode();
                  }
                }}
                spellCheck={false}
                placeholder={`// Type in ${currentLang.name}, paste code here, or use simulation buttons above...`}
                className="relative z-10 w-full h-full min-h-[460px] py-3 px-3 bg-transparent text-stone-200 outline-none resize-none font-mono text-xs leading-6 selection:bg-amber-500/30 selection:text-amber-200 whitespace-pre"
              />
            </div>
          </div>

          {/* VS Code Style Status Bar with Language Selector */}
          <div className="px-4 py-1.5 bg-stone-900 border-t border-stone-800 flex items-center justify-between text-[11px] font-mono text-stone-400">
            <div className="flex items-center gap-4">
              <span className="text-amber-400 font-semibold flex items-center gap-1">
                <Code2 className="w-3 h-3" />
                Line {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span>
                Typed: <strong className="text-emerald-400">{currentFileStats.percentages.typed}%</strong>
              </span>
              <span>
                Pasted: <strong className="text-yellow-400">{currentFileStats.percentages.pasted}%</strong>
              </span>
              <span>
                AI: <strong className="text-sky-400">{currentFileStats.percentages.ai}%</strong>
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Syntax Health Indicator */}
              {validationResult.isValid ? (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  Syntax: Valid {currentLang.name}
                </span>
              ) : (
                <span className="text-rose-400 font-semibold flex items-center gap-1 animate-pulse">
                  <AlertOctagon className="w-3 h-3 text-rose-400" />
                  Syntax: {validationResult.errors.length} Mismatch Error(s)
                </span>
              )}

              <span className="flex items-center gap-1 text-stone-300">
                <Link2 className="w-3 h-3 text-emerald-400" />
                Chain: {chain.length} Links
              </span>
              <span className="text-stone-500">UTF-8</span>

              {/* Clickable Language Mode in Status Bar (like VS Code) */}
              <button
                onClick={() => setLanguageModalOpen(true)}
                className="text-amber-300 hover:text-amber-200 font-medium flex items-center gap-1 bg-stone-800/80 px-1.5 py-0.5 rounded border border-stone-700/50"
                title="Select language mode"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: currentLang.color }}
                />
                <span>{currentLang.name}</span>
              </button>
            </div>
          </div>

          {/* Phase 13: Native Execution & Provenance-Aware Output Channel */}
          <div className="rounded-xl border border-stone-800 bg-stone-950 flex flex-col shadow-xl overflow-hidden font-mono mt-3">
            {/* Output Channel Header */}
            <div className="px-4 py-2 bg-stone-900 border-b border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-stone-200">Provenance Output Channel</span>
                <span className="text-[10px] text-stone-500">[{currentFile.name}]</span>
                {executionResult && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                      executionResult.crashed
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {executionResult.crashed ? 'CRASHED' : 'EXIT 0'}
                  </span>
                )}
                {executionResult && (
                  <span className="text-[10px] text-stone-500">{executionResult.durationMs}ms</span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs">
                {/* Run Button in Output Channel */}
                <button
                  id="btn-run-code-console"
                  onClick={() => handleRunCode()}
                  disabled={isExecuting}
                  className="px-2 py-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white font-semibold flex items-center gap-1 text-[11px] transition-colors disabled:opacity-50"
                  title="Run code in sandboxed engine"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Run</span>
                </button>

                {/* Simulate Crash button to test provenance alert */}
                <button
                  id="btn-simulate-crash"
                  onClick={() => {
                    const targetLine = selectedLineIndex !== null ? selectedLineIndex + 1 : Math.min(3, currentFile.lines.length);
                    handleRunCode(targetLine);
                  }}
                  className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-1 text-[11px] transition-colors"
                  title="Simulate runtime crash on current line to verify origin tracking"
                >
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span>Test Crash</span>
                </button>

                {/* Clear Output button */}
                <button
                  onClick={handleClearConsole}
                  className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors"
                  title="Clear output channel logs"
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                {/* Toggle Collapse */}
                <button
                  onClick={() => setIsConsoleOpen(!isConsoleOpen)}
                  className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors"
                  title={isConsoleOpen ? 'Collapse Output Channel' : 'Expand Output Channel'}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isConsoleOpen ? '' : 'rotate-180'}`} />
                </button>
              </div>
            </div>

            {/* Remote Sync Notification Banner */}
            {remoteSyncResult && (
              <div className="px-4 py-2 bg-sky-950/60 border-b border-sky-800/60 text-xs flex items-center justify-between text-sky-200">
                <div className="flex items-center gap-2">
                  <GitPullRequest className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>{remoteSyncResult.message}</span>
                </div>
                <span className="text-[10px] text-sky-400 font-mono">
                  {new Date(remoteSyncResult.timestamp).toLocaleTimeString()}
                </span>
              </div>
            )}

            {/* Output Channel Body */}
            {isConsoleOpen && (
              <div className="p-3 bg-black/90 text-stone-300 text-xs leading-5 max-h-[220px] overflow-y-auto">
                {!executionResult ? (
                  <div className="text-stone-500 py-3 text-center flex flex-col items-center gap-1">
                    <span>[Provenance Output Channel] Ready.</span>
                    <span className="text-[11px] text-stone-600">
                      Click <strong className="text-emerald-400">Run Code</strong> or press <kbd className="px-1 py-0.5 rounded bg-stone-900 border border-stone-800 text-stone-400">Ctrl+Enter</kbd> to execute. Any crash will report line origin provenance.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {executionResult.output.map((line, idx) => (
                      <div
                        key={idx}
                        className={`${
                          line.startsWith('⚠️ [PROVENANCE ALERT]')
                            ? 'p-2.5 my-1 rounded-lg bg-rose-950/80 border border-rose-500/80 text-rose-200 font-bold shadow-md'
                            : line.includes('[ERROR]') || line.includes('[STDERR]') || line.includes('[Runtime Error]')
                            ? 'text-rose-400 font-semibold'
                            : line.includes('[WARN]')
                            ? 'text-yellow-400'
                            : line.startsWith('[Provenance Execution Engine]') || line.startsWith('[Environment]')
                            ? 'text-stone-500 text-[11px]'
                            : line.startsWith('---')
                            ? 'text-stone-700'
                            : 'text-stone-200'
                        }`}
                      >
                        {line}
                      </div>
                    ))}

                    {/* Quick Action when Crashed: Jump to Line */}
                    {executionResult.crashed && executionResult.crashLine && (
                      <div className="mt-2 pt-2 border-t border-stone-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-stone-400 text-[11px]">
                          <span>Origin classification:</span>
                          <span
                            className={`px-1.5 py-0.2 rounded uppercase font-bold text-[10px] ${
                              executionResult.crashOrigin === 'ai'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : executionResult.crashOrigin === 'pasted'
                                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {formatOriginLabel(executionResult.crashOrigin)}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedLineIndex(executionResult.crashLine! - 1)}
                          className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] flex items-center gap-1 transition-colors"
                        >
                          <span>Inspect Line {executionResult.crashLine}</span>
                          <ChevronRight className="w-3 h-3 text-amber-400" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Live Telemetry Stream & Line Inspector (Col 4) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Line Provenance Inspector Card */}
          <div className="rounded-xl border border-stone-800 bg-stone-950 p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2">
              <h3 className="text-xs font-semibold text-stone-200 flex items-center gap-1.5 font-mono">
                <Info className="w-3.5 h-3.5 text-amber-400" />
                Line Inspector {selectedLineIndex !== null ? `(Line ${selectedLineIndex + 1})` : ''}
              </h3>
              {selectedLineIndex !== null && (
                <button
                  onClick={() => setSelectedLineIndex(null)}
                  className="text-[10px] text-stone-500 hover:text-stone-300 font-mono"
                >
                  Deselect
                </button>
              )}
            </div>

            {selectedLineIndex !== null && selectedLineMeta ? (
              <div className="flex flex-col gap-2.5 text-xs font-mono">
                {/* Line text snippet */}
                <div className="p-2 rounded bg-stone-900 border border-stone-800 text-[11px] text-stone-300 truncate">
                  {textLines[selectedLineIndex] || '<empty line>'}
                </div>

                {/* Syntax Mismatch Error Box if this line has an error */}
                {errorsByLineIndex.has(selectedLineIndex) && (
                  <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/70 text-xs flex flex-col gap-1.5 text-rose-200 shadow-md animate-in fade-in">
                    <div className="flex items-center gap-1.5 font-bold text-rose-300">
                      <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>Language Mismatch Detected</span>
                    </div>
                    <p className="text-[11px] text-rose-100 font-sans leading-snug">
                      {errorsByLineIndex.get(selectedLineIndex)?.message}
                    </p>
                    <div className="text-[11px] text-amber-300 font-sans bg-black/40 p-1.5 rounded border border-amber-500/20">
                      💡 <strong>Fix:</strong> {errorsByLineIndex.get(selectedLineIndex)?.suggestion}
                    </div>
                  </div>
                )}

                {/* Origin tag & language */}
                <div className="flex items-center justify-between">
                  <span className="text-stone-400">Classified Origin:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-stone-500">[{currentLang.name}]</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        selectedLineMeta.origin === 'typed'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : selectedLineMeta.origin === 'pasted'
                          ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                          : selectedLineMeta.origin === 'ai'
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          : 'bg-stone-800 text-stone-400'
                      }`}
                    >
                      {selectedLineMeta.origin}
                    </span>
                  </div>
                </div>

                {/* Detection explanation */}
                <div className="p-2.5 rounded bg-stone-900/60 border border-stone-800/80 text-[11px] text-stone-400 leading-relaxed">
                  {selectedLineMeta.origin === 'typed' && (
                    <span>
                      Detected via incremental human keystrokes in {currentLang.name} without clipboard matches.
                    </span>
                  )}
                  {selectedLineMeta.origin === 'pasted' && (
                    <span>
                      Detected via clipboard event. Multi-line or atomic chunk of {currentLang.name} was inserted into the buffer.
                    </span>
                  )}
                  {selectedLineMeta.origin === 'ai' && (
                    <span>
                      Detected as AI Copilot generation. Synthetic multi-line code block in {currentLang.name}.
                    </span>
                  )}
                  {selectedLineMeta.origin === 'unknown' && (
                    <span>
                      Initial baseline or legacy untracked line.
                    </span>
                  )}
                </div>

                {/* Manual tag override row for testing */}
                <div className="pt-1 flex items-center justify-between gap-1 text-[10px]">
                  <span className="text-stone-500">Override Tag:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleOverrideLineOrigin(selectedLineIndex, 'typed')}
                      className="px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    >
                      Typed
                    </button>
                    <button
                      onClick={() => handleOverrideLineOrigin(selectedLineIndex, 'pasted')}
                      className="px-1.5 py-0.5 rounded bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                    >
                      Pasted
                    </button>
                    <button
                      onClick={() => handleOverrideLineOrigin(selectedLineIndex, 'ai')}
                      className="px-1.5 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    >
                      AI
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-stone-500 font-mono flex flex-col items-center gap-2">
                <Code2 className="w-6 h-6 text-stone-700" />
                <span>Click any line or gutter badge to inspect its provenance heuristics.</span>
              </div>
            )}
          </div>

          {/* Real-time Detection Telemetry Feed */}
          <div className="rounded-xl border border-stone-800 bg-stone-950 p-4 flex flex-col gap-3 shadow-xl flex-1 max-h-[360px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2">
              <h3 className="text-xs font-semibold text-stone-200 flex items-center gap-1.5 font-mono">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Live Detection Telemetry
              </h3>
              <span className="text-[10px] text-stone-500 font-mono">
                {detectionLogs.length} events
              </span>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto pr-1">
              {detectionLogs.length === 0 ? (
                <div className="text-xs text-stone-500 font-mono py-8 text-center">
                  Awaiting edits... Type or paste code in any language.
                </div>
              ) : (
                detectionLogs.slice(0, 15).map((log) => {
                  let badgeBg = 'bg-stone-800 text-stone-400';
                  if (log.type === 'typed') badgeBg = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
                  if (log.type === 'pasted') badgeBg = 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
                  if (log.type === 'ai') badgeBg = 'bg-sky-500/20 text-sky-300 border border-sky-500/30';
                  if (log.type === 'shift') badgeBg = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';

                  return (
                    <div
                      key={log.id}
                      className="p-2 rounded bg-stone-900/70 border border-stone-800/80 flex flex-col gap-1 font-mono text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold ${badgeBg}`}>
                          {log.type}
                        </span>
                        <span className="text-[10px] text-stone-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="font-medium text-stone-200">{log.summary}</div>
                      <div className="text-[10px] text-stone-400">{log.details}</div>
                      {log.hashSnippet && (
                        <div className="text-[9px] text-stone-500 truncate">
                          link: <span className="text-amber-400/80">{log.hashSnippet}...</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* LANGUAGE SELECTOR MODAL */}
      {languageModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-700 rounded-xl p-5 max-w-xl w-full flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-stone-100 font-mono">
                  Select Programming Language
                </h3>
              </div>
              <button
                onClick={() => setLanguageModalOpen(false)}
                className="text-stone-400 hover:text-stone-200 text-xs font-mono"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-stone-400">
              Select any language without limitations. Provenance tracking, keystroke detection, paste heuristics, and hash chains work identically across all languages.
            </p>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-stone-500" />
              <input
                type="text"
                placeholder="Search language (e.g., Python, Rust, Go, SQL, Swift)..."
                value={langSearchQuery}
                onChange={(e) => setLangSearchQuery(e.target.value)}
                className="w-full bg-stone-950 border border-stone-800 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-stone-200 outline-none focus:border-amber-500/50"
                autoFocus
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                    selectedCategory === cat
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                      : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Language Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
              {filteredLanguages.map((lang) => {
                const isSelected = currentLang.id === lang.id;
                return (
                  <button
                    key={lang.id}
                    onClick={() => handleSelectLanguage(lang, false)}
                    className={`p-2.5 rounded-lg border text-left flex items-center justify-between font-mono text-xs transition-all ${
                      isSelected
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                        : 'border-stone-800 bg-stone-950/60 hover:bg-stone-800 text-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: lang.color }}
                      />
                      <span className="font-semibold truncate">{lang.name}</span>
                    </div>
                    <span className="text-[10px] text-stone-500 shrink-0 ml-1">
                      {lang.extension}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Option to also load template */}
            <div className="pt-2 border-t border-stone-800 flex items-center justify-between">
              <span className="text-xs text-stone-400">
                Want to replace current code with sample starter boilerplate?
              </span>
              <button
                onClick={() => handleSelectLanguage(currentLang, true)}
                className="px-3 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-mono flex items-center gap-1"
              >
                <BookOpen className="w-3 h-3 text-amber-400" />
                <span>Load {currentLang.name} Template</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW FILE MODAL */}
      {newFileModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-700 rounded-xl p-5 max-w-md w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
              <h3 className="text-sm font-semibold text-stone-100 flex items-center gap-2 font-mono">
                <FilePlus className="w-4 h-4 text-amber-400" />
                Create New File in Any Language
              </h3>
              <button
                onClick={() => setNewFileModalOpen(false)}
                className="text-stone-400 hover:text-stone-200 text-xs font-mono"
              >
                Cancel
              </button>
            </div>

            {/* Choose Language */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-stone-400 font-mono">Select Language:</label>
              <select
                value={newFileLangId}
                onChange={(e) => {
                  setNewFileLangId(e.target.value);
                  const l = getLanguageById(e.target.value);
                  setNewFileName(l.defaultFilename);
                }}
                className="bg-stone-950 border border-stone-800 rounded-lg p-2.5 text-xs font-mono text-stone-200 outline-none"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.extension}) - {l.category}
                  </option>
                ))}
              </select>
            </div>

            {/* File name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-stone-400 font-mono">File Name / Path:</label>
              <input
                type="text"
                value={newFileName || getLanguageById(newFileLangId).defaultFilename}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="e.g. src/algorithm.py"
                className="bg-stone-950 border border-stone-800 rounded-lg p-2.5 text-xs font-mono text-stone-200 outline-none"
              />
            </div>

            {/* Starter boilerplate checkbox */}
            <label className="flex items-center gap-2 text-xs text-stone-300 font-mono cursor-pointer">
              <input
                type="checkbox"
                checked={includeStarterTemplate}
                onChange={(e) => setIncludeStarterTemplate(e.target.checked)}
                className="rounded accent-amber-400 cursor-pointer"
              />
              <span>Include starter boilerplate template</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                onClick={() => setNewFileModalOpen(false)}
                className="px-3 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-mono"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const lang = getLanguageById(newFileLangId);
                  const nameToUse = newFileName.trim() || lang.defaultFilename;
                  const initialContent = includeStarterTemplate ? lang.starterCode : '';
                  onAddFile(nameToUse, lang.id, initialContent);
                  setNewFileModalOpen(false);
                  setNewFileName('');
                }}
                className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs font-mono flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Create File</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Paste Dialog Modal */}
      {customPasteModalOpen && (() => {
        const pasteCompatibility = customPasteContent.trim()
          ? isSnippetCompatible(customPasteContent, currentLang.id)
          : { compatible: true };

        return (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-stone-900 border border-stone-700 rounded-xl p-5 max-w-lg w-full flex flex-col gap-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                <h3 className="text-sm font-semibold text-stone-100 flex items-center gap-2 font-mono">
                  <Clipboard className="w-4 h-4 text-yellow-400" />
                  Paste Code Snippet ({currentLang.name})
                </h3>
                <button
                  onClick={() => setCustomPasteModalOpen(false)}
                  className="text-stone-400 hover:text-stone-200 text-xs font-mono"
                >
                  Cancel
                </button>
              </div>

              <p className="text-xs text-stone-400">
                Paste code below to insert into <strong>{currentLang.name}</strong>. {isStrictMode && 'Strict language isolation is active: foreign language syntax will be blocked.'}
              </p>

              <textarea
                value={customPasteContent}
                onChange={(e) => setCustomPasteContent(e.target.value)}
                placeholder={`Paste your ${currentLang.name} code here...`}
                rows={8}
                className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-xs font-mono text-stone-200 outline-none resize-y"
              />

              {!pasteCompatibility.compatible && isStrictMode && (
                <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs font-mono flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Restricted: Detected {pasteCompatibility.detectedLang} Syntax</div>
                    <div className="text-[11px] text-stone-300 mt-0.5">{pasteCompatibility.reason}</div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCustomPasteModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-mono"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (customPasteContent.trim()) {
                      handleInsertSnippet(customPasteContent, 'pasted', `Custom Paste (${currentLang.name})`);
                      setCustomPasteContent('');
                      setCustomPasteModalOpen(false);
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-yellow-500 hover:bg-yellow-400 text-stone-950 font-bold text-xs font-mono flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Inject as PASTED</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Blocked Paste / Insertion Modal (Strict Language Restriction) */}
      {blockedPasteData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-rose-500/60 rounded-xl p-5 max-w-lg w-full flex flex-col gap-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2.5 text-rose-400 font-mono font-bold text-sm">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <span>Strict Language Restriction Enforced</span>
              </div>
              <button
                onClick={() => setBlockedPasteData(null)}
                className="text-stone-400 hover:text-stone-200 text-xs font-mono"
              >
                Close
              </button>
            </div>

            <div className="bg-rose-950/30 border border-rose-800/60 rounded-lg p-3.5 flex flex-col gap-1.5 text-xs font-mono">
              <div className="text-rose-200 font-bold text-sm flex items-center gap-2">
                <span>Cross-Language Code Insertion Blocked</span>
                <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 text-[10px]">
                  Environment: {currentLang.name}
                </span>
              </div>
              <p className="text-stone-300 text-xs leading-relaxed mt-1">
                You are currently in the <strong className="text-amber-300">{currentLang.name}</strong> environment. Writing or pasting code containing syntax for <strong className="text-rose-300">{blockedPasteData.detectedLang}</strong> is restricted.
              </p>
              {blockedPasteData.reason && (
                <div className="text-[11px] text-stone-400 bg-stone-950/70 p-2 rounded border border-stone-800/80 mt-1">
                  <strong>Violation Rule:</strong> {blockedPasteData.reason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1 text-xs font-mono text-stone-400">
              <span className="font-semibold text-stone-300">Attempted Code:</span>
              <pre className="p-2.5 rounded bg-stone-950 border border-stone-800 text-[11px] text-stone-300 max-h-32 overflow-y-auto whitespace-pre">
                {blockedPasteData.text.slice(0, 300)}
                {blockedPasteData.text.length > 300 ? '\n... (truncated)' : ''}
              </pre>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-stone-800 font-mono text-xs">
              <button
                onClick={() => setBlockedPasteData(null)}
                className="px-3.5 py-1.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 font-medium"
              >
                Cancel & Keep File Clean
              </button>
              {(() => {
                const targetLang =
                  findLanguageByKeyword(blockedPasteData.detectedLang) ||
                  SUPPORTED_LANGUAGES.find((l) =>
                    l.name.toLowerCase().includes(blockedPasteData.detectedLang.toLowerCase())
                  );

                if (targetLang) {
                  return (
                    <button
                      onClick={() => {
                        handleSelectLanguage(targetLang, false);
                        handleInsertSnippet(
                          blockedPasteData.text,
                          blockedPasteData.origin || 'pasted',
                          `Pasted (${targetLang.name})`
                        );
                        setBlockedPasteData(null);
                        showToast(`Switched file to ${targetLang.name} and inserted code.`);
                      }}
                      className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold flex items-center gap-1.5 transition-colors shadow"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Switch to {targetLang.name} & Paste</span>
                    </button>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
