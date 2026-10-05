import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInspectionFilter, loadDatabaseSourceFile } from '../../src/lib/database.js';
import { combineDatabaseViews, countCombinedFiles } from '../../src/lib/combine.js';

async function view(db, filter = '') {
  const source = await loadDatabaseSourceFile(
    new File([JSON.stringify(db)], `${db.db_id}.json`, { type: 'application/json' }),
  );
  return { dbId: db.db_id, view: applyInspectionFilter(source.inspection, filter) };
}

function database(dbId, { files = {}, folders = {}, archives = {}, tag_dictionary } = {}) {
  return {
    db_id: dbId,
    v: 1,
    timestamp: 1710000000,
    base_files_url: `https://example.com/${dbId}/`,
    files,
    folders,
    archives,
    ...(tag_dictionary ? { tag_dictionary } : {}),
  };
}

function treePaths(tree) {
  const paths = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      paths.push(`${node.kind === 'folder' ? 'D' : 'F'} ${node.path}${node.dbId ? ` @${node.dbId}` : ''}`);
      visit(node.children ?? []);
    }
  };
  visit(tree.children);
  return paths;
}

test('databases without shared paths are shown side by side, each file tagged with its database', async () => {
  const combined = combineDatabaseViews([
    await view(database('alpha', { files: { 'cores/a.rbf': { size: 1, hash: 'a' } }, folders: { 'cores/': {} } })),
    await view(database('beta', { files: { 'games/b.rom': { size: 2, hash: 'b' } }, folders: { 'games/': {} } })),
  ]);

  assert.deepEqual(treePaths(combined.filesystemTree), [
    'D cores/',
    'F cores/a.rbf @alpha',
    'D games/',
    'F games/b.rom @beta',
  ]);
  assert.deepEqual(combined.collisions, []);
  assert.deepEqual(combined.resultCounts, { files: 2, folders: 2, archives: 0 });
});

test('a path in two databases becomes a collision, listing both versions, and leaves the tree', async () => {
  const combined = combineDatabaseViews([
    await view(database('alpha', { files: { 'cores/x.rbf': { size: 1, hash: 'one' }, 'cores/a.rbf': { size: 1 } } })),
    await view(database('beta', { files: { 'cores/x.rbf': { size: 2, hash: 'two' } } })),
  ]);

  assert.equal(combined.collisions.length, 1);
  const [collision] = combined.collisions;
  assert.equal(collision.path, 'cores/x.rbf');
  assert.equal(collision.identical, false);
  assert.deepEqual(collision.dbIds, ['alpha', 'beta']);
  assert.deepEqual(
    collision.versions.map((version) => [version.dbId, version.origin, version.record.hash]),
    [['alpha', 'files', 'one'], ['beta', 'files', 'two']],
  );
  assert.deepEqual(treePaths(combined.filesystemTree), ['D cores/', 'F cores/a.rbf @alpha']);
  assert.deepEqual(combined.resultCounts, { files: 2, folders: 0, archives: 0 });
  assert.equal(combined.issues[0].context, 'collisions');
  assert.match(combined.issues[0].message, /^1 path is claimed by more than one database: alpha, beta\./);
});

test('paths that differ only in letter case collide, and their folders merge', async () => {
  const combined = combineDatabaseViews([
    await view(database('alpha', { files: { 'Games/NES/Mario.nes': { size: 1, hash: 'm' }, 'Games/NES/a.nes': { size: 1 } } })),
    await view(database('beta', { files: { 'games/nes/mario.nes': { size: 1, hash: 'M' }, 'games/nes/b.nes': { size: 1 } } })),
  ]);

  assert.deepEqual(combined.collisions.map((collision) => [collision.key, collision.identical]), [
    ['games/nes/mario.nes', true],
  ]);
  assert.deepEqual(treePaths(combined.filesystemTree), [
    'D Games/',
    'D Games/NES/',
    'F Games/NES/a.nes @alpha',
    'F games/nes/b.nes @beta',
  ]);
});

test('identical copies are marked identical only when every version has the same hash and size', async () => {
  const identical = combineDatabaseViews([
    await view(database('alpha', { files: { 'x.rbf': { size: 5, hash: 'abc' } } })),
    await view(database('beta', { files: { 'x.rbf': { size: 5, hash: 'ABC' } } })),
  ]);
  const unknownHash = combineDatabaseViews([
    await view(database('alpha', { files: { 'x.rbf': { size: 5, hash: 'abc' } } })),
    await view(database('beta', { files: { 'x.rbf': { size: 5 } } })),
  ]);

  assert.equal(identical.collisions[0].identical, true);
  assert.match(identical.issues[0].message, /\(1 with identical copies\)/);
  assert.equal(unknownHash.collisions[0].identical, false);
});

test('archive summary files collide with other databases files, and the archive stays listed', async () => {
  const archive = {
    description: 'Cheats',
    format: 'zip',
    extract: 'selective',
    target_folder: 'cheats/',
    archive_file: { url: 'https://example.com/cheats.zip', size: 10, hash: 'z' },
    summary_inline: {
      files: { 'cheats/nes/a.zip': { arc_id: 'cheats', arc_at: 'a.zip', size: 3, hash: 'a' } },
      folders: { 'cheats/nes/': {} },
    },
  };
  const combined = combineDatabaseViews([
    await view(database('alpha', { archives: { cheats: archive } })),
    await view(database('beta', { files: { 'cheats/nes/a.zip': { size: 4, hash: 'b' } } })),
  ]);

  assert.deepEqual(
    combined.collisions[0].versions.map((version) => [version.dbId, version.origin, version.archiveId]),
    [['alpha', 'archive', 'cheats'], ['beta', 'files', null]],
  );
  assert.equal(combined.archiveViews.length, 1);
  assert.equal(combined.archiveViews[0].nodeId, 'archive[alpha]:cheats');
  assert.deepEqual(combined.archiveViews[0].summaryRecords.map((record) => record.id), [
    'archive[alpha]:cheats:folder:cheats/nes/',
  ]);
  assert.deepEqual(treePaths(combined.filesystemTree), []);
});

test('a file where another database needs a folder collides with that folder', async () => {
  const combined = combineDatabaseViews([
    await view(database('alpha', { files: { 'games/x': { size: 1 } } })),
    await view(database('beta', { files: { 'games/x/y.rom': { size: 1 } } })),
  ]);

  assert.deepEqual(
    combined.collisions.map((collision) => [collision.key, collision.versions.map((v) => `${v.dbId}:${v.origin}`)]),
    [['games/x', ['alpha:files', 'beta:folder']]],
  );
  assert.equal(combined.collisions[0].identical, false);
  assert.deepEqual(treePaths(combined.filesystemTree), [
    'D games/',
    'D games/x/',
    'F games/x/y.rom @beta',
  ]);
});

test('collisions only count what each database filter keeps', async () => {
  const tags = { tag_dictionary: { arcade: 0, console: 1 } };
  const combined = combineDatabaseViews([
    await view(database('alpha', { ...tags, files: { 'x.rbf': { size: 1, tags: [0] } } })),
    await view(database('beta', { ...tags, files: { 'x.rbf': { size: 1, tags: [1] } } }), 'arcade'),
  ]);

  assert.deepEqual(combined.collisions, []);
  assert.deepEqual(treePaths(combined.filesystemTree), ['F x.rbf @alpha']);
  assert.equal(combined.isFiltering, true);
});

test('archives with the same id in two databases stay apart', async () => {
  const archive = (hash) => ({
    format: 'zip',
    extract: 'selective',
    archive_file: { url: `https://example.com/${hash}.zip` },
    summary_inline: { files: { [`${hash}/f.bin`]: { arc_id: 'shared', arc_at: 'f.bin' } }, folders: {} },
  });
  const combined = combineDatabaseViews([
    await view(database('alpha', { archives: { shared: archive('a') } })),
    await view(database('beta', { archives: { shared: archive('b') } })),
  ]);

  assert.deepEqual(
    combined.archiveViews.map((archiveView) => [archiveView.nodeId, archiveView.dbId, archiveView.summaryRecords[0].id]),
    [
      ['archive[alpha]:shared', 'alpha', 'archive[alpha]:shared:file:a/f.bin'],
      ['archive[beta]:shared', 'beta', 'archive[beta]:shared:file:b/f.bin'],
    ],
  );
  assert.equal(combined.archiveViews[1].tree.children[0].id, 'archive[beta]:shared:missingfolder:b');
});

test('issues name their database, and each collided path counts once for the size estimate', async () => {
  const combined = combineDatabaseViews([
    await view(database('alpha', { files: { 'x.rbf': { size: 10, hash: 'a' }, 'y.rbf': { size: 1 } } })),
    await view({ ...database('beta', { files: { 'x.rbf': { size: 30, hash: 'b' } } }), timestamp: 'soon' }),
  ]);

  const betaIssue = combined.issues.find((issue) => issue.dbId === 'beta');
  assert.match(betaIssue.message, /timestamp/);
  assert.match(betaIssue.id, /^beta:/);
  assert.deepEqual(
    combined.storageView.filesystemRecords.filter((record) => record.kind === 'file').map((record) => [record.path, record.sizeBytes]),
    [['y.rbf', 1], ['x.rbf', 30]],
  );
});

test('counting the files of combined databases gives what combining them counts, without combining them', async () => {
  const archive = (id, files) => ({
    [id]: {
      description: id,
      format: 'zip',
      extract: 'all',
      target_folder: 'games/',
      archive_file: { url: `https://example.com/${id}.zip`, size: 1, hash: id },
      summary_inline: { files: Object.fromEntries(Object.entries(files).map(([path, file]) => [path, { arc_id: id, ...file }])), folders: {} },
    },
  });
  const scenarios = {
    'no shared paths': [
      database('alpha', { files: { 'cores/a.rbf': { size: 1, hash: 'a' } }, folders: { 'cores/': {} } }),
      database('beta', { files: { 'games/b.rom': { size: 2, hash: 'b' } } }),
    ],
    'a file two databases install, and a case variant of it': [
      database('alpha', { files: { 'cores/shared.rbf': { size: 1, hash: 'a' }, 'cores/Only.rbf': { size: 1, hash: 'o' } } }),
      database('beta', { files: { 'CORES/Shared.rbf': { size: 1, hash: 'a' }, 'cores/other.rbf': { size: 1, hash: 'x' } } }),
    ],
    'an archive file another database installs': [
      database('alpha', { files: { 'games/one.rom': { size: 1, hash: 'o' } } }),
      database('beta', { archives: archive('roms', { 'games/one.rom': { size: 1, hash: 'o' }, 'games/two.rom': { size: 1, hash: 't' } }) }),
    ],
    // Alpha installs games/nes twice (from its files and an archive): one collided path still counts once.
    'a file where another database needs a folder, declared or implied': [
      database('alpha', { files: { 'games/nes': { size: 1, hash: 'n' }, 'docs': { size: 1, hash: 'd' } }, archives: archive('more', { 'games/nes': { size: 1, hash: 'n' } }) }),
      database('beta', { files: { 'games/nes/a.nes': { size: 1, hash: 'a' } }, folders: { 'docs/': {} } }),
    ],
    'a path one database installs twice, from its files and an archive': [
      database('alpha', { files: { 'games/one.rom': { size: 1, hash: 'o' } }, archives: archive('roms', { 'games/one.rom': { size: 1, hash: 'o' } }) }),
      database('beta', { files: { 'games/b.rom': { size: 1, hash: 'b' } } }),
    ],
    'three databases': [
      database('alpha', { files: { 'a/x.bin': { size: 1, hash: 'x' }, 'a/y.bin': { size: 1, hash: 'y' } } }),
      database('beta', { files: { 'a/x.bin': { size: 2, hash: 'x2' }, 'b/z.bin': { size: 1, hash: 'z' } } }),
      database('gamma', { files: { 'a/x.bin': { size: 1, hash: 'x' }, 'a/y.bin/inside.bin': { size: 1, hash: 'i' } } }),
    ],
  };

  for (const [name, databases] of Object.entries(scenarios)) {
    const entries = await Promise.all(databases.map((db) => view(db)));
    assert.equal(countCombinedFiles(entries), combineDatabaseViews(entries).resultCounts.files, name);
  }
  // With filters, as combined views are.
  const filtered = [
    await view(database('alpha', { tag_dictionary: { keep: 0 }, files: { 'a.bin': { size: 1, hash: 'a', tags: [0] }, 'b.bin': { size: 1, hash: 'b' } } }), '!keep'),
    await view(database('beta', { files: { 'b.bin': { size: 1, hash: 'b' } } })),
  ];
  assert.equal(countCombinedFiles(filtered), combineDatabaseViews(filtered).resultCounts.files);
  assert.equal(countCombinedFiles(filtered), 1);
});

