const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LineStore } = require('../src/lineStore');
const {
  buildProvenancePayload,
  writeProvenanceNote,
  readProvenanceNote,
  getHeadCommitHash,
  pushProvenance,
  runGitCommand,
  PROVENANCE_REF
} = require('../src/gitNotes');

test('buildProvenancePayload generates privacy-compliant snapshot without code', () => {
  const store = new LineStore();
  const filePath = 'src/app.js';

  // Seed store with simulated lines
  store.getOrCreate(filePath, 3);
  const lines = store.getLines(filePath);
  lines[0] = { origin: 'typed', timestamp: 1000, text: 'secret user code' };
  lines[1] = { origin: 'pasted', timestamp: 2000, text: 'clipboard code' };
  lines[2] = { origin: 'ai', timestamp: 3000, text: 'copilot suggestion' };

  const payload = buildProvenancePayload(store, [filePath]);

  assert.equal(payload.version, 1);
  assert.equal(typeof payload.timestamp, 'number');
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].path, filePath);
  assert.deepEqual(payload.files[0].summary, {
    typed: 1,
    pasted: 1,
    ai: 1,
    unknown: 0,
    total: 3
  });

  // Verify privacy constraint: strictly no code text or clipboard stored!
  const jsonString = JSON.stringify(payload);
  assert.ok(!jsonString.includes('secret user code'), 'Must never store raw code');
  assert.ok(!jsonString.includes('clipboard code'), 'Must never store clipboard text');
  assert.ok(!jsonString.includes('copilot suggestion'), 'Must never store AI generated text');

  // Verify line item format
  assert.deepEqual(payload.files[0].lines[0], { line: 0, origin: 'typed', timestamp: 1000 });
});

test('Git Notes persistence lifecycle in real temporary git repository', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-notes-test-'));

  try {
    // 1. Initialize git repo and identity
    await runGitCommand(tmpDir, ['init']);
    await runGitCommand(tmpDir, ['config', 'user.name', 'Provenance Bot']);
    await runGitCommand(tmpDir, ['config', 'user.email', 'bot@example.com']);

    // 2. Create initial commit
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
    await runGitCommand(tmpDir, ['add', 'test.txt']);
    await runGitCommand(tmpDir, ['commit', '-m', 'Initial commit']);

    const commitSha = await getHeadCommitHash(tmpDir);
    assert.ok(commitSha && commitSha.length >= 40);

    // 3. Write provenance note
    const samplePayload = {
      version: 1,
      timestamp: 1712345678900,
      files: [{ path: 'test.txt', summary: { typed: 1, total: 1 } }]
    };

    const written = await writeProvenanceNote(tmpDir, 'HEAD', samplePayload);
    assert.equal(written, true);

    // 4. Read note back
    const retrieved = await readProvenanceNote(tmpDir, 'HEAD');
    assert.deepEqual(retrieved, samplePayload);

    // 5. Verify commit hash was NOT changed by the note
    const commitShaAfter = await getHeadCommitHash(tmpDir);
    assert.equal(commitShaAfter, commitSha, 'Git note must never alter the commit SHA');

    // 6. Verify notes ref exists under refs/notes/provenance
    const notesList = await runGitCommand(tmpDir, ['notes', `--ref=${PROVENANCE_REF}`, 'list']);
    assert.ok(notesList.includes(commitSha));

    // 7. Test pushProvenance with a bare local remote repo
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-remote-test-'));
    try {
      await runGitCommand(remoteDir, ['init', '--bare']);
      await runGitCommand(tmpDir, ['remote', 'add', 'origin', remoteDir]);

      const pushRes = await pushProvenance(tmpDir, 'origin');
      assert.equal(pushRes.success, true);
      assert.ok(pushRes.message.includes(PROVENANCE_REF));

      // Verify remote received the provenance notes ref
      const remoteRefs = await runGitCommand(remoteDir, ['for-each-ref', '--format=%(refname)']);
      assert.ok(remoteRefs.includes(PROVENANCE_REF));
    } finally {
      fs.rmSync(remoteDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
