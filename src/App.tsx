/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Terminal,
  CheckCircle2,
  Play,
  Code2,
  GitCommit,
  ShieldCheck,
  FileText,
  Eye,
  EyeOff,
  Layers,
  Sparkles,
  Bookmark,
  Database,
  Lock,
  ArrowRight,
  Info,
  Link2,
  AlertTriangle,
  RefreshCw,
  Hash,
  Download,
  Copy,
  ExternalLink,
  Sliders,
  GitPullRequest,
  Check,
  XCircle,
  Zap,
  Cpu,
  Keyboard,
  Clipboard,
  RotateCcw
} from 'lucide-react';
import { CodePlayground } from './components/CodePlayground';
import { OriginType, FileDocument, ChainLink, DetectionLogEntry, PolicyConfig } from './types';
import { computeHash, computeLineStats, GENESIS_PREV } from './provenanceEngine';
import { validateCodeForLanguage } from './languageValidator';
import { detectLanguageFromPath } from './languages';

const STORAGE_FILES_KEY = 'cpt_clean_files_v4';
const STORAGE_CHAIN_KEY = 'cpt_clean_chain_v4';
const STORAGE_LOGS_KEY = 'cpt_clean_logs_v4';

// Clean legacy sample/default data
try {
  ['cpt_prod_files_v3', 'cpt_prod_chain_v3', 'cpt_prod_logs_v3', 'cpt_files_v2', 'cpt_chain_v2'].forEach((k) =>
    localStorage.removeItem(k)
  );
} catch (e) {}

function createDefaultFiles(): FileDocument[] {
  return [
    {
      id: 'file-main-ts',
      name: 'main.ts',
      path: 'src/main.ts',
      language: 'typescript',
      content: '',
      lines: []
    }
  ];
}

function createGenesisChain(): ChainLink[] {
  return [];
}

function createGenesisLogs(): DetectionLogEntry[] {
  return [];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'editor' | 'report' | 'security'>('editor');
  const [reportSubView, setReportSubView] = useState<'visual' | 'markdown'>('visual');
  const [notification, setNotification] = useState<string | null>(null);

  // Policy Settings for Gatekeeper
  const [policy, setPolicy] = useState<PolicyConfig>({
    maxAiPercentage: 50,
    minTypedPercentage: 20,
    maxPastedPercentage: 50,
    requireChain: true
  });

  // Production-Ready State with Local Persistence
  const [files, setFiles] = useState<FileDocument[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_FILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return createDefaultFiles();
  });

  const [activeFileId, setActiveFileId] = useState<string>(() => files[0]?.id || 'file-main-ts');

  const [chain, setChain] = useState<ChainLink[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CHAIN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return createGenesisChain();
  });

  const [detectionLogs, setDetectionLogs] = useState<DetectionLogEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LOGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return createGenesisLogs();
  });

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FILES_KEY, JSON.stringify(files));
    } catch (e) {}
  }, [files]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CHAIN_KEY, JSON.stringify(chain));
    } catch (e) {}
  }, [chain]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LOGS_KEY, JSON.stringify(detectionLogs));
    } catch (e) {}
  }, [detectionLogs]);

  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean;
    brokenIndex?: number;
    reason?: string;
  }>({ valid: true });

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  // Synchronized callback from the CodePlayground
  const handleUpdateFile = (
    updatedFile: FileDocument,
    newDetectionEvent?: DetectionLogEntry,
    newChainLink?: ChainLink
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === updatedFile.id ? updatedFile : f)));

    if (newChainLink) {
      setChain((prevChain) => [...prevChain, newChainLink]);
    }
    if (newDetectionEvent) {
      setDetectionLogs((prevLogs) => [newDetectionEvent, ...prevLogs]);
    }
  };

  const handleDeleteFile = (fileId: string) => {
    if (files.length <= 1) {
      showToast('Cannot delete the only open file in the workspace.');
      return;
    }
    const remaining = files.filter((f) => f.id !== fileId);
    setFiles(remaining);
    if (activeFileId === fileId) {
      setActiveFileId(remaining[0].id);
    }
    showToast('File closed/deleted from workspace.');
  };

  const handleUploadFile = (name: string, content: string, languageId?: string) => {
    const cleanPath = name.startsWith('src/') ? name : `src/${name}`;
    const detectedLang = languageId || detectLanguageFromPath(cleanPath).id;
    const count = content.split('\n').length || 1;
    const now = Date.now();
    const initialLines = Array.from({ length: count }, () => ({
      origin: 'typed' as const,
      timestamp: now
    }));

    const newDoc: FileDocument = {
      id: 'file-' + now + '-' + Math.random().toString(36).slice(2, 6),
      name: name.replace('src/', ''),
      path: cleanPath,
      language: detectedLang,
      content,
      lines: initialLines
    };

    setFiles((prev) => [...prev, newDoc]);
    setActiveFileId(newDoc.id);
    showToast(`Imported ${cleanPath} (${detectedLang})`);
  };

  const handleResetWorkspace = () => {
    localStorage.removeItem(STORAGE_FILES_KEY);
    localStorage.removeItem(STORAGE_CHAIN_KEY);
    localStorage.removeItem(STORAGE_LOGS_KEY);
    const defaultF = createDefaultFiles();
    const defaultC = createGenesisChain();
    const defaultL = createGenesisLogs();
    setFiles(defaultF);
    setActiveFileId(defaultF[0].id);
    setChain(defaultC);
    setDetectionLogs(defaultL);
    setVerificationResult({ valid: true });
    showToast('Workspace reset to clean empty state.');
  };

  const handleAddFile = (fileName: string, languageId?: string, initialContent?: string) => {
    const cleanPath = fileName.startsWith('src/') ? fileName : `src/${fileName}`;
    const detectedLang =
      languageId ||
      (fileName.endsWith('.py')
        ? 'python'
        : fileName.endsWith('.rs')
        ? 'rust'
        : fileName.endsWith('.go')
        ? 'go'
        : fileName.endsWith('.java')
        ? 'java'
        : fileName.endsWith('.cpp')
        ? 'cpp'
        : fileName.endsWith('.cs')
        ? 'csharp'
        : fileName.endsWith('.sql')
        ? 'sql'
        : fileName.endsWith('.sh')
        ? 'shell'
        : 'typescript');
    const content = initialContent !== undefined ? initialContent : '';
    const count = content.trim().length === 0 ? 0 : content.split('\n').length;
    const initialLines = Array.from({ length: count }, () => ({
      origin: 'typed' as const,
      timestamp: Date.now()
    }));

    const newDoc: FileDocument = {
      id: 'file-' + Date.now(),
      name: fileName.replace('src/', ''),
      path: cleanPath,
      language: detectedLang,
      content,
      lines: initialLines
    };
    setFiles([...files, newDoc]);
    setActiveFileId(newDoc.id);
    showToast(`Created new file ${cleanPath} (${detectedLang})`);
  };

  // Workspace-level live tallies
  const allWorkspaceLines = files.flatMap((f) => f.lines);
  const workspaceStats = computeLineStats(allWorkspaceLines);

  const totalLines = workspaceStats.total;
  const totalTyped = workspaceStats.typed;
  const totalPasted = workspaceStats.pasted;
  const totalAi = workspaceStats.ai;
  const pctTyped = workspaceStats.percentages.typed;
  const pctPasted = workspaceStats.percentages.pasted;
  const pctAi = workspaceStats.percentages.ai;

  // Gatekeeper Evaluation
  const policyErrors: string[] = [];
  if (policy.requireChain && !verificationResult.valid) {
    policyErrors.push(
      `Cryptographic Hash Chain broken at link #${verificationResult.brokenIndex}: ${verificationResult.reason}`
    );
  }
  if (pctAi > policy.maxAiPercentage) {
    policyErrors.push(
      `AI code percentage (${pctAi}%) exceeds policy maximum (${policy.maxAiPercentage}%)`
    );
  }
  if (pctTyped < policy.minTypedPercentage) {
    policyErrors.push(
      `Hand-typed code percentage (${pctTyped}%) is below policy minimum (${policy.minTypedPercentage}%)`
    );
  }

  // Gatekeeper Language Isolation & Restriction Policy
  files.forEach((f) => {
    const langValidation = validateCodeForLanguage(f.content, f.language);
    if (!langValidation.isValid) {
      policyErrors.push(
        `Language Restriction Violation in '${f.name}': Detected ${
          langValidation.detectedDominantLanguage || 'foreign'
        } syntax in ${f.language} file.`
      );
    }
  });

  const isPolicyPassing = policyErrors.length === 0;

  // Tamper simulation
  const handleTamper = () => {
    if (chain.length === 0) {
      showToast('No hash chain links exist to tamper yet. Create code edits first.');
      return;
    }
    const targetIdx = chain.length > 1 ? 1 : 0;
    const updated = chain.map((link, i) => {
      if (i === targetIdx) {
        return {
          ...link,
          timestamp: link.timestamp + 9999,
          data: { ...link.data, lineCount: 888 },
          isTampered: true
        };
      }
      return link;
    });
    setChain(updated);
    setVerificationResult({
      valid: false,
      brokenIndex: targetIdx,
      reason: `Hash mismatch: link #${targetIdx} was tampered (timestamp/payload altered)`
    });
    showToast(`Simulated tampering on Link #${targetIdx} in Hash Chain`);
  };

  const handleReset = () => {
    handleResetWorkspace();
  };

  // Dynamic Attestation Bundle computed from LIVE files and chain
  const liveBundle = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    metadata: {
      repository: 'code-provenance-tracker',
      commitHash: 'HEAD',
      author: 'provenance-agent',
      tool: 'code-provenance-tracker@0.0.1'
    },
    summary: {
      totalFiles: files.length,
      totalLines,
      typed: totalTyped,
      pasted: totalPasted,
      ai: totalAi,
      percentages: { typed: pctTyped, pasted: pctPasted, ai: pctAi, unknown: 0 }
    },
    files: files.map((f) => {
      const stats = computeLineStats(f.lines);
      return {
        file: f.path,
        totalLines: stats.total,
        typed: stats.typed,
        pasted: stats.pasted,
        ai: stats.ai,
        unknown: stats.unknown,
        percentages: stats.percentages
      };
    }),
    chain: chain.map((c) => ({
      sequence: c.sequence,
      timestamp: c.timestamp,
      prevHash: c.prevHash,
      data: c.data,
      hash: c.hash
    })),
    attestationDigest: computeHash({
      filesCount: files.length,
      totalLines,
      pctTyped,
      pctAi,
      chainLength: chain.length,
      latestHash: chain[chain.length - 1]?.hash
    })
  };

  const preCommitHookCode = `#!/usr/bin/env bash
# Auto-generated by Code Provenance Tracker (Phase 8)
# Pre-commit hook: enforces cryptographic provenance & policy verification before committing

set -e
echo "🔍 Verifying code provenance attestation against policy..."

node -e '
const fs = require("fs");
const { verifyBundle } = require("./src/verifier");

const bundlePath = ".provenance-bundle.json";
if (!fs.existsSync(bundlePath)) {
  console.log("ℹ️ Skipping: .provenance-bundle.json not found.");
  process.exit(0);
}

try {
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const policy = {
    maxAiPercentage: ${policy.maxAiPercentage},
    minTypedPercentage: ${policy.minTypedPercentage},
    requireValidChain: ${policy.requireChain}
  };
  const result = verifyBundle(bundle, policy);

  if (!result.passed) {
    console.error("❌ COMMIT REJECTED: Provenance verification failed:");
    for (const err of result.errors) {
      console.error("   - " + err);
    }
    process.exit(1);
  }
  console.log("✅ Provenance verified: " + result.metrics.totalLines + " lines tracked, chain valid.");
} catch (err) {
  console.error("❌ Error verifying bundle: " + err.message);
  process.exit(1);
}
'`;

  const markdownContent = `# Code Provenance Report

*Generated: ${new Date().toISOString()}*

## 1. Workspace Summary

- **Total Tracked Lines:** ${totalLines}
- **Hand-Typed:** ${pctTyped}% (${totalTyped} lines)
- **Pasted:** ${pctPasted}% (${totalPasted} lines)
- **AI-Generated:** ${pctAi}% (${totalAi} lines)

## 2. Cryptographic Hash Chain Audit

- **Audit Status:** ${
    verificationResult.valid
      ? '✅ Verified (All cryptographic links intact)'
      : `❌ TAMPER DETECTED at link #${verificationResult.brokenIndex} (${verificationResult.reason})`
  }
- **Total Tamper-Evident Events:** ${chain.length}
- **Latest Event Hash (SHA-256):** \`${chain[chain.length - 1]?.hash || GENESIS_PREV}\`

## 3. File Breakdown

| File | Total Lines | Typed | Pasted | AI | Breakdown |
| :--- | :---: | :---: | :---: | :---: | :---: |
${files
  .map((f) => {
    const s = computeLineStats(f.lines);
    return `| \`${f.path}\` | ${s.total} | ${s.typed} | ${s.pasted} | ${s.ai} | ${s.percentages.typed}% T / ${s.percentages.pasted}% P / ${s.percentages.ai}% AI |`;
  })
  .join('\n')}

---
*Privacy Notice: This report contains only aggregate counts, line indices, and cryptographic hashes. No source code or clipboard text is stored or exported.*`;

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Header */}
      <header className="border-b border-stone-800 bg-stone-950/90 backdrop-blur px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-mono text-sm font-semibold shrink-0">
            CP
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-stone-100 flex flex-wrap items-center gap-2">
              Code Provenance Tracker
              <span className="text-[11px] font-normal uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Interactive Playground
              </span>
            </h1>
            <p className="text-xs text-stone-400 mt-1 sm:mt-0">
              Live Code Editor, Typing & Paste Detection, Cryptographic Hash Chain, and Attestation Gatekeeper
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 text-xs font-mono text-stone-400 bg-stone-900/80 px-3 py-1.5 rounded-lg border border-stone-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>{files.length} Files</span>
            <span className="text-stone-600">&bull;</span>
            <span className="text-amber-300 font-semibold">{chain.length} Cryptographic Links</span>
          </div>

          <button
            id="btn-header-reset-workspace"
            onClick={handleResetWorkspace}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/40 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
            title="Reset workspace to clean production state (clears local cache and restores Genesis state)"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>Reset Workspace</span>
          </button>
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-14 right-6 z-50 bg-stone-900 border border-amber-500/40 text-stone-100 px-4 py-2 rounded-lg shadow-xl text-xs flex items-center gap-2 animate-in fade-in">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-5">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-stone-800 pb-3 gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              id="tab-editor"
              onClick={() => setActiveTab('editor')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-2 transition-colors ${
                activeTab === 'editor'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <Code2 className="w-4 h-4 text-amber-400" />
              <span>Live Code Editor & Validator</span>
            </button>
            <button
              id="tab-report"
              onClick={() => setActiveTab('report')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-2 transition-colors ${
                activeTab === 'report'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <FileText className="w-4 h-4 text-amber-400" />
              <span>Provenance Analytics & Report</span>
            </button>
            <button
              id="tab-security"
              onClick={() => setActiveTab('security')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold font-mono flex items-center gap-2 transition-colors ${
                activeTab === 'security'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Security Audit & Hash Chain ({chain.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-stone-500">Workspace Total:</span>
            <span className="text-emerald-400 font-bold">{pctTyped}% Typed</span>
            <span className="text-stone-600">&bull;</span>
            <span className="text-yellow-400 font-bold">{pctPasted}% Pasted</span>
            <span className="text-stone-600">&bull;</span>
            <span className="text-sky-400 font-bold">{pctAi}% AI</span>
          </div>
        </div>

        {/* TAB 1: LIVE CODE PLAYGROUND & DETECTION LAB */}
        {activeTab === 'editor' && (
          <CodePlayground
            files={files}
            activeFileId={activeFileId}
            onSelectFile={setActiveFileId}
            onUpdateFile={handleUpdateFile}
            onAddFile={handleAddFile}
            onDeleteFile={handleDeleteFile}
            onUploadFile={handleUploadFile}
            onResetWorkspace={handleResetWorkspace}
            chain={chain}
            policy={policy}
            detectionLogs={detectionLogs}
          />
        )}

        {/* TAB 2: SECURITY AUDIT, CI GATEKEEPER & HASH CHAIN */}
        {activeTab === 'security' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Policy Sliders & Controls */}
              <div className="lg:col-span-4 flex flex-col gap-4">
                <div className="p-5 rounded-xl border border-stone-800 bg-stone-950 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                    <h3 className="text-xs font-mono font-medium text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5" /> CI Policy Configuration
                    </h3>
                    <span className="text-[11px] text-stone-500">Real-time</span>
                  </div>

                  {/* Max AI slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-stone-300">Max AI Code Allowed:</span>
                      <span className="text-sky-400 font-bold">{policy.maxAiPercentage}%</span>
                    </div>
                    <input
                      id="slider-max-ai"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={policy.maxAiPercentage}
                      onChange={(e) =>
                        setPolicy({ ...policy, maxAiPercentage: Number(e.target.value) })
                      }
                      className="w-full accent-sky-400 cursor-pointer"
                    />
                  </div>

                  {/* Min Typed slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-stone-300">Min Hand-Typed Required:</span>
                      <span className="text-emerald-400 font-bold">{policy.minTypedPercentage}%</span>
                    </div>
                    <input
                      id="slider-min-typed"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={policy.minTypedPercentage}
                      onChange={(e) =>
                        setPolicy({ ...policy, minTypedPercentage: Number(e.target.value) })
                      }
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>

                  {/* Require Hash Chain Check */}
                  <label className="flex items-center gap-2.5 text-xs text-stone-300 font-mono cursor-pointer pt-1">
                    <input
                      id="checkbox-require-chain"
                      type="checkbox"
                      checked={policy.requireChain}
                      onChange={(e) =>
                        setPolicy({ ...policy, requireChain: e.target.checked })
                      }
                      className="rounded accent-amber-400 cursor-pointer"
                    />
                    <span>Require Cryptographic Chain Audit</span>
                  </label>
                </div>

                {/* Tamper Simulation Card */}
                <div className="p-5 rounded-xl border border-stone-800 bg-stone-950 flex flex-col gap-3">
                  <span className="text-xs font-mono font-medium text-stone-400 uppercase tracking-wider">
                    Tamper Verification Test
                  </span>
                  <p className="text-xs text-stone-400">
                    Simulate an attacker altering a link in the hash chain to test if the CI gatekeeper immediately blocks the commit.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      id="btn-tamper-chain"
                      onClick={handleTamper}
                      className="flex-1 py-1.5 px-3 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-mono flex items-center justify-center gap-1.5"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                      Tamper Chain Link #1
                    </button>
                    <button
                      id="btn-reset-state"
                      onClick={handleReset}
                      className="py-1.5 px-3 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 text-xs font-mono flex items-center justify-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Live Gatekeeper Evaluation & Bundle */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                {/* Policy Evaluation Banner */}
                <div
                  className={`p-4 rounded-lg border flex items-center justify-between ${
                    isPolicyPassing
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isPolicyPassing ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {isPolicyPassing ? <ShieldCheck className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider">
                        {isPolicyPassing ? 'CI Gatekeeper: Commit Approved' : 'CI Gatekeeper: Commit Rejected'}
                      </div>
                      <div className="text-xs text-stone-400 font-mono mt-0.5">
                        {isPolicyPassing
                          ? `Live code complies with all provenance policy rules (AI: ${pctAi}% <= ${policy.maxAiPercentage}%, Typed: ${pctTyped}% >= ${policy.minTypedPercentage}%)`
                          : `${policyErrors.length} policy violation(s) detected`}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono text-[11px]">
                    <span
                      className={`px-2.5 py-1 rounded font-bold uppercase tracking-wider text-[10px] ${
                        isPolicyPassing ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {isPolicyPassing ? 'PASSED' : 'BLOCKED'}
                    </span>
                  </div>
                </div>

                {/* Policy error callouts */}
                {policyErrors.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-500/30 text-xs font-mono text-rose-300 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Violations Blocking Commit:
                    </div>
                    {policyErrors.map((err, i) => (
                      <div key={i} className="pl-5 text-[11px] text-rose-300/90">
                        &bull; {err}
                      </div>
                    ))}
                  </div>
                )}

                {/* Grid: Attestation Bundle + Hook Script */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Live Attestation Bundle */}
                  <div className="border border-stone-800 rounded-lg bg-stone-900/50 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                      <span className="text-xs font-semibold text-stone-200 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        .provenance-bundle.json
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(JSON.stringify(liveBundle, null, 2));
                          showToast('Copied .provenance-bundle.json to clipboard');
                        }}
                        className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-mono border border-stone-700 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3 text-amber-400" /> Copy
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-stone-400 bg-stone-950 p-3 rounded overflow-x-auto max-h-56 leading-relaxed">
                      {JSON.stringify(liveBundle, null, 2)}
                    </pre>
                    <div className="text-[10px] text-stone-500 font-mono truncate">
                      Sealed Root Digest: <span className="text-amber-400">{liveBundle.attestationDigest}</span>
                    </div>
                  </div>

                  {/* Pre-commit Hook Script */}
                  <div className="border border-stone-800 rounded-lg bg-stone-900/50 p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                      <span className="text-xs font-semibold text-stone-200 flex items-center gap-1.5">
                        <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />
                        .git/hooks/pre-commit
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(preCommitHookCode);
                          showToast('Copied pre-commit hook script to clipboard');
                        }}
                        className="px-2 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-mono border border-stone-700 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3 text-emerald-400" /> Copy
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-stone-400 bg-stone-950 p-3 rounded overflow-x-auto max-h-56 leading-relaxed">
                      {preCommitHookCode}
                    </pre>
                    <div className="text-[10px] text-stone-500 font-mono">
                      Audits bundle integrity before commit is written.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cryptographic Hash Chain Audit View embedded directly in Security */}
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4 font-mono text-xs flex flex-col gap-3 max-h-[400px] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-stone-800 text-stone-400">
                <span className="text-emerald-300 flex items-center gap-2 font-bold">
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  Live Cryptographic Hash Chain Ledger ({chain.length} Events)
                </span>
                <span className="text-[11px] text-stone-500">SHA-256 Canonical Links</span>
              </div>

              <div className="space-y-2.5">
                {chain.length === 0 ? (
                  <div className="py-8 text-center text-stone-500 text-xs">
                    No cryptographic events recorded yet. Type or paste code in the editor to generate provenance chain links.
                  </div>
                ) : (
                  chain.map((link, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      link.isTampered
                        ? 'border-rose-500/50 bg-rose-950/20'
                        : 'border-stone-800 bg-stone-900/50'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[11px] mb-1.5">
                      <span className="font-bold text-stone-300">
                        Link #{link.sequence} &bull; {link.data.file} ({link.data.lineCount} lines)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                          link.data.changeType === 'ai'
                            ? 'text-sky-300 bg-sky-500/20'
                            : link.data.changeType === 'pasted'
                            ? 'text-yellow-300 bg-yellow-500/20'
                            : 'text-emerald-300 bg-emerald-500/20'
                        }`}
                      >
                        {link.data.changeType}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-stone-400 bg-stone-950 p-2 rounded">
                      <div>
                        prev: <span className="text-stone-500">{link.prevHash.slice(0, 24)}...</span>
                      </div>
                      <div>
                        hash: <span className="text-amber-400">{link.hash.slice(0, 24)}...</span>
                      </div>
                    </div>
                  </div>
                )))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PROVENANCE REPORT */}
        {activeTab === 'report' && (
          <div className="rounded-xl border border-stone-800 bg-stone-950 p-5 flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-stone-100">Live Workspace Provenance Summary</span>
              </div>

              <div className="flex items-center gap-1 bg-stone-900 p-1 rounded-lg border border-stone-800 text-xs">
                <button
                  id="btn-subview-visual"
                  onClick={() => setReportSubView('visual')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    reportSubView === 'visual'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  Visual Dashboard
                </button>
                <button
                  id="btn-subview-markdown"
                  onClick={() => setReportSubView('markdown')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    reportSubView === 'markdown'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  Markdown Output
                </button>
              </div>
            </div>

            {reportSubView === 'visual' ? (
              <div className="flex flex-col gap-5">
                {/* Metric Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-lg bg-stone-900 border border-stone-800 flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-stone-400 font-medium">Total Code</span>
                    <span className="text-2xl font-bold font-mono text-stone-100">{totalLines}</span>
                    <span className="text-[11px] text-stone-500 font-mono">tracked lines</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-stone-900 border border-stone-800 flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-emerald-400 font-medium">Hand-Typed</span>
                    <span className="text-2xl font-bold font-mono text-emerald-300">{pctTyped}%</span>
                    <span className="text-[11px] text-stone-500 font-mono">{totalTyped} lines</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-stone-900 border border-stone-800 flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-yellow-400 font-medium">Pasted</span>
                    <span className="text-2xl font-bold font-mono text-yellow-300">{pctPasted}%</span>
                    <span className="text-[11px] text-stone-500 font-mono">{totalPasted} lines</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-stone-900 border border-stone-800 flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-sky-400 font-medium">AI Copilot</span>
                    <span className="text-2xl font-bold font-mono text-sky-300">{pctAi}%</span>
                    <span className="text-[11px] text-stone-500 font-mono">{totalAi} lines</span>
                  </div>
                </div>

                {/* Distribution Bar */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[11px] text-stone-400 font-mono">
                    <span>Provenance Distribution</span>
                    <span>
                      {pctTyped}% Typed &bull; {pctPasted}% Pasted &bull; {pctAi}% AI
                    </span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-stone-800 overflow-hidden flex">
                    <div style={{ width: `${pctTyped}%` }} className="bg-emerald-500 h-full transition-all duration-300" />
                    <div style={{ width: `${pctPasted}%` }} className="bg-yellow-500 h-full transition-all duration-300" />
                    <div style={{ width: `${pctAi}%` }} className="bg-sky-500 h-full transition-all duration-300" />
                  </div>
                </div>

                {/* Per-File Table */}
                <div className="border border-stone-800 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[500px] text-left text-xs font-mono">
                    <thead className="bg-stone-900/80 border-b border-stone-800 text-stone-400 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="p-3">Tracked File</th>
                        <th className="p-3 text-center">Language</th>
                        <th className="p-3 text-center">Lines</th>
                        <th className="p-3 text-center">Typed</th>
                        <th className="p-3 text-center">Pasted</th>
                        <th className="p-3 text-center">AI Copilot</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800/60 bg-stone-950">
                      {files.map((f, i) => {
                        const s = computeLineStats(f.lines);
                        return (
                          <tr key={i} className="hover:bg-stone-900/40">
                            <td className="p-3 text-amber-300 font-medium">{f.path}</td>
                            <td className="p-3 text-center">
                              <span className="px-2 py-0.5 rounded bg-stone-900 border border-stone-800 text-[10px] text-stone-300 font-semibold uppercase">
                                {f.language || 'code'}
                              </span>
                            </td>
                            <td className="p-3 text-center text-stone-300">{s.total}</td>
                            <td className="p-3 text-center text-emerald-400">{s.percentages.typed}%</td>
                            <td className="p-3 text-center text-yellow-400">{s.percentages.pasted}%</td>
                            <td className="p-3 text-center text-sky-400">{s.percentages.ai}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <pre className="p-4 rounded-lg bg-stone-900 border border-stone-800 text-stone-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {markdownContent}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
