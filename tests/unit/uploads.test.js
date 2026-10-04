import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { isDownloaderDatabase, readUploadCandidate } from '../../src/lib/database.js';
import {
  captureDrop,
  hashContent,
  isSingleFileDrop,
  isUploadCandidateName,
  listChosenFiles,
  listDroppedFiles,
  scanUploads,
} from '../../src/lib/uploads.js';

const database = (dbId, extra = {}) => ({ db_id: dbId, timestamp: 1710000000, files: {}, folders: {}, ...extra });
const bytesOf = (value) => strToU8(typeof value === 'string' ? value : JSON.stringify(value));
const zipOf = (name, value) => zipSync({ [name]: bytesOf(value) });
const file = (name, content) => new File([content instanceof Uint8Array ? content : bytesOf(content)], name);

test('only databases that Downloader would accept count', () => {
  assert.equal(isDownloaderDatabase(database('a')), true);
  assert.equal(isDownloaderDatabase(database('a', { v: 1, archives: {}, tag_dictionary: {}, linux: null })), true);
  for (const broken of [
    null,
    [],
    { ...database('a'), db_id: '' },
    { ...database('a'), db_id: 7 },
    { db_id: 'a', files: {}, folders: {} },
    { db_id: 'a', timestamp: 1, folders: {} },
    { db_id: 'a', timestamp: 1, files: {} },
    database('a', { timestamp: '1710000000' }),
    database('a', { files: [] }),
    database('a', { v: -1 }),
    database('a', { v: null }),
    database('a', { zips: null }),
    database('a', { archives: [] }),
    database('a', { tag_dictionary: 'x' }),
    database('a', { linux: 'x' }),
    database('a', { base_files_url: null }),
  ]) {
    assert.equal(isDownloaderDatabase(broken), false, JSON.stringify(broken));
  }
});

test('upload candidates are databases or database lists, and anything unreadable is null', () => {
  assert.deepEqual(readUploadCandidate(bytesOf(database('a')), 'a.json'), { kind: 'database', dbId: 'a' });
  assert.deepEqual(readUploadCandidate(zipOf('db.json', database('b')), 'b.json.zip'), { kind: 'database', dbId: 'b' });
  assert.equal(readUploadCandidate(bytesOf({ theme: 'dark' }), 'settings.json'), null);
  assert.equal(readUploadCandidate(bytesOf('{'), 'broken.json'), null);
  assert.equal(readUploadCandidate(bytesOf('[MiSTer]\nvideo_mode=0\n[menu]\nkey=1\n'), 'MiSTer.ini'), null);

  const list = readUploadCandidate(bytesOf('[mister]\nfilter=arcade\n\n[a]\ndb_url=https://example.com/a.json\n'), 'x.ini');
  assert.equal(list.kind, 'ini');
  assert.equal(list.defaultFilter, 'arcade');
  assert.deepEqual(list.entries.map(({ dbId }) => dbId), ['a']);
});

test('only .ini, .json and .json.zip files are read', () => {
  assert.deepEqual(
    ['a.json', 'B.JSON.ZIP', 'downloader.ini', 'a.zip', 'a.ini.zip', 'a.txt', 'json'].map(isUploadCandidateName),
    [true, true, true, false, false, false, false],
  );
});

test('uploaded files are listed by path, with identical files read once and other files skipped', async () => {
  const listText = '[mister]\nfilter=arcade\n\n[gamma]\ndb_url=https://example.com/gamma.json\nfilter=[mister] snes\n';
  const files = [
    { path: 'root/z/list.ini', file: file('list.ini', listText) },
    { path: 'root/b.json.zip', file: file('b.json.zip', zipOf('db.json', database('beta'))) },
    { path: 'root/a10.json', file: file('a10.json', database('alpha', { timestamp: 2 })) },
    { path: 'root/a2.json', file: file('a2.json', database('alpha')) },
    { path: 'root/copy/a2.json', file: file('a2.json', database('alpha')) },
    { path: 'root/zipped-list.json.zip', file: file('zipped-list.json.zip', zipOf('list.ini', listText)) },
    { path: 'root/notes.txt', file: file('notes.txt', 'hello') },
    { path: 'root/settings.json', file: file('settings.json', { theme: 'dark' }) },
  ];
  const progress = [];

  const scan = await scanUploads(files, { onProgress: (read, total) => progress.push(`${read}/${total}`) });

  assert.deepEqual(
    scan.entries.map(({ dbId, origin, title }) => [dbId, origin, title ?? null]),
    [
      ['alpha', 'root/a2.json', 'Database file'],
      ['alpha', 'root/a10.json', 'Database file'],
      ['beta', 'root/b.json.zip', 'Database file'],
      ['gamma', 'root/z/list.ini', null],
    ],
  );
  assert.equal(new Set(scan.entries.map(({ key }) => key)).size, 4);
  assert.equal(scan.entries[0].file, files[3].file);
  assert.equal(scan.entries[3].dbUrl, 'https://example.com/gamma.json');
  assert.equal(scan.entries[3].sectionFilter, '[mister] snes');
  assert.equal(scan.fileCount, 4);
  assert.deepEqual(scan.misterOptions.map(({ label, filter }) => [label, filter]), [['root/z/list.ini', 'arcade']]);
  assert.deepEqual(scan.lists.map(({ source }) => source.sourceLabel), ['root/z/list.ini']);
  assert.deepEqual(progress, ['0/7', '1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);
});

test('identical content always gets the same digest, with or without SubtleCrypto', async () => {
  const one = bytesOf(database('a'));
  const same = bytesOf(database('a'));
  const other = bytesOf(database('b'));
  for (const subtle of [globalThis.crypto.subtle, undefined]) {
    assert.equal(await hashContent(one, subtle), await hashContent(same, subtle));
    assert.notEqual(await hashContent(one, subtle), await hashContent(other, subtle));
  }
  assert.match(await hashContent(one), /^[0-9a-f]{64}$/);
});

// A folder or file as browsers list them when dropped (FileSystemEntry).
function fileEntry(fullPath, content = '{}') {
  const name = fullPath.split('/').at(-1);
  return { isFile: true, isDirectory: false, name, fullPath, file: (resolve) => resolve(file(name, content)) };
}

function directoryEntry(fullPath, children, { batchSize = 2, unreadable = false } = {}) {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').at(-1),
    fullPath,
    createReader() {
      let offset = 0;
      return {
        readEntries(resolve, reject) {
          if (unreadable) {
            reject(new Error('not allowed'));
            return;
          }
          resolve(children.slice(offset, offset + batchSize));
          offset += batchSize;
        },
      };
    },
  };
}

test('dropped folders are walked through every batch of every subfolder', async () => {
  const drop = {
    entries: [
      directoryEntry('/dbs', [
        fileEntry('/dbs/a.json'),
        fileEntry('/dbs/readme.md'),
        directoryEntry('/dbs/deep', [fileEntry('/dbs/deep/b.json.zip'), fileEntry('/dbs/deep/c.ini')]),
        directoryEntry('/dbs/locked', [fileEntry('/dbs/locked/d.json')], { unreadable: true }),
        fileEntry('/dbs/e.json'),
      ]),
      fileEntry('/loose.json'),
    ],
    files: [],
  };

  const found = await listDroppedFiles(drop);

  assert.deepEqual(found.map(({ path }) => path), ['dbs/a.json', 'dbs/deep/b.json.zip', 'dbs/deep/c.ini', 'dbs/e.json', 'loose.json']);
  assert.ok(found.every(({ file: found }) => found instanceof File));
});

test('a drop is read as entries when the browser can list folders, else as files', () => {
  const plainFile = file('a.json', '{}');
  const item = (entry) => ({ kind: 'file', webkitGetAsEntry: () => entry });

  const withEntries = captureDrop({ items: [item(fileEntry('/a.json'))], files: [plainFile] });
  assert.equal(withEntries.entries.length, 1);
  assert.equal(isSingleFileDrop(withEntries), true);
  assert.equal(isSingleFileDrop(captureDrop({ items: [item(directoryEntry('/dbs', []))], files: [] })), false);

  const withoutEntries = captureDrop({ items: [item(null), item(null)], files: [plainFile, plainFile] });
  assert.equal(withoutEntries.entries, null);
  assert.equal(isSingleFileDrop(withoutEntries), false);
  assert.deepEqual(captureDrop({ items: [{ kind: 'string' }], files: [] }), { entries: null, files: [] });
});

test('chosen files are listed by name', () => {
  assert.deepEqual(listChosenFiles([file('a.json', '{}'), file('b.json', '{}')]).map(({ path }) => path), ['a.json', 'b.json']);
});
