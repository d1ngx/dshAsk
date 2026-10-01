const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const { writeOfficeFile } = await import('../integrations/kodbox-file/office-bytes.js');
  const { withFileLock } = await import('../integrations/kodbox-file/session-security.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-write-'));
  try {
    const file = path.join(dir, 'result.docx');
    const candidates = Array.from({ length: 20 }, (_, index) => Buffer.alloc(1024 * 32, index));
    await Promise.all(candidates.map(bytes => writeOfficeFile(file, bytes)));
    const final = await fs.readFile(file);
    assert(candidates.some(bytes => bytes.equals(final)), 'no mixed document bytes');
    assert.deepEqual(await fs.readdir(dir), ['result.docx'], 'no abandoned temporary files');
    await fs.writeFile(file, '0');
    await Promise.all(Array.from({ length: 20 }, () => withFileLock(file, async () => {
      const before = Number(await fs.readFile(file, 'utf8'));
      await writeOfficeFile(file, String(before + 1));
    })));
    assert.equal(await fs.readFile(file, 'utf8'), '20', 'read-modify-write transactions do not lose updates');
    await assert.rejects(withFileLock(file, () => Promise.reject(Error('failed'))));
    assert.equal(await withFileLock(file, () => 42), 42, 'failed transaction releases its queue');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(writeOfficeFile(file, 'bad', controller.signal));
    assert.equal(await fs.readFile(file, 'utf8'), '20', 'cancelled write preserves old content');
    console.log('Concurrent writes: intact bytes, no temp collisions, serialized revisions and cancellation passed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
