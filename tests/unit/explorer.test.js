import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInspectionFilter, loadDatabaseSourceFile } from '../../src/lib/database.js';
import { combineDatabaseViews } from '../../src/lib/combine.js';
import {
  EXPLORER_VIEW_STORAGE_KEY,
  buildExplorerTree,
  explorerAncestors,
  explorerWindow,
  moveExplorerSelection,
  readExplorerView,
  resolveExplorerLocation,
  revealExplorerLine,
  splitNameEnd,
  splitTileName,
  startExplorerHistory,
  stepExplorerHistory,
  storeExplorerView,
  visitExplorerFolder,
} from '../../src/lib/explorer.js';

async function view(db, filter = '') {
  const source = await loadDatabaseSourceFile(new File([JSON.stringify(db)], `${db.db_id}.json`, { type: 'application/json' }));
  return applyInspectionFilter(source.inspection, filter);
}

function database(dbId, { files = {}, folders = {}, archives = {}, tag_dictionary } = {}) {
  return { db_id: dbId, v: 1, timestamp: 1710000000, base_files_url: `https://example.com/${dbId}/`, files, folders, archives, ...(tag_dictionary ? { tag_dictionary } : {}) };
}

function archive(id, targetFolder, files, folders = {}) {
  return {
    description: id,
    format: 'zip',
    extract: 'all',
    target_folder: targetFolder,
    archive_file: { url: `https://example.com/${id}.zip`, size: 1000, hash: `${id}-hash` },
    summary_inline: { files, folders },
  };
}

// Every entry under a folder, as `D path` or `F path`, depth first in the explorer's order.
function listing(folder) {
  return folder.children.flatMap((entry) => (entry.kind === 'folder' ? [`D ${entry.path}`, ...listing(entry)] : [`F ${entry.path}`]));
}

// What a database with an archive that extracts into its own folders installs.
const ARCADE = database('arcade_db', {
  tag_dictionary: { arcade: 0, cheats: 1 },
  files: {
    '_Arcade/cores/Arkanoid_20240525.rbf': { size: 3000, hash: 'core-a', tags: [0] },
    '_Arcade/Arkanoid.mra': { size: 30, hash: 'mra-a', tags: [0] },
    'Cheats/MegaCD/cheat.zip': { size: 5, hash: 'cheat-cd', tags: [1] },
    'menu.rbf': { size: 100, hash: 'menu' },
  },
  folders: { '_Arcade/': { tags: [0] }, '_Arcade/cores/': {}, 'Cheats/': { tags: [1] }, 'Cheats/MegaCD/': {} },
  archives: {
    mra_alternatives: archive('mra_alternatives', '_Arcade/', {
      '_Arcade/_alternatives/_Arkanoid/Arkanoid (Japan).mra': { arc_id: 'mra_alternatives', size: 40, hash: 'alt-a' },
      '_Arcade/_alternatives/_Arkanoid/Arkanoid (US).mra': { arc_id: 'mra_alternatives', size: 41, hash: 'alt-b' },
    }, { '_Arcade/_alternatives/': { arc_id: 'mra_alternatives' }, '_Arcade/_alternatives/_Arkanoid/': { arc_id: 'mra_alternatives' } }),
    cheats_nes: archive('cheats_nes', 'Cheats/', {
      'cheats/NES/game.zip': { arc_id: 'cheats_nes', size: 7, hash: 'cheat-nes', tags: [1] },
    }, { 'Cheats/': { arc_id: 'cheats_nes' } }),
  },
});

test('the SD card puts the database files and the files inside its archives in the folders they install to', async () => {
  const tree = buildExplorerTree(await view(ARCADE));

  // Folders first, then files, by name; archives themselves are not shown, only what they hold.
  assert.deepEqual(listing(tree), [
    'D _Arcade',
    'D _Arcade/_alternatives',
    'D _Arcade/_alternatives/_Arkanoid',
    'F _Arcade/_alternatives/_Arkanoid/Arkanoid (Japan).mra',
    'F _Arcade/_alternatives/_Arkanoid/Arkanoid (US).mra',
    'D _Arcade/cores',
    'F _Arcade/cores/Arkanoid_20240525.rbf',
    'F _Arcade/Arkanoid.mra',
    'D Cheats',
    'D Cheats/MegaCD',
    'F Cheats/MegaCD/cheat.zip',
    // The archive's `cheats/NES` is the database's `Cheats`, as the SD card compares paths ignoring
    // letter case: the first name met stays.
    'D Cheats/NES',
    'F Cheats/NES/game.zip',
    'F menu.rbf',
  ]);
  assert.equal(tree.name, 'SD card');
  assert.equal(tree.path, '');

  // Every folder counts the files it holds at any depth, and adds up their sizes.
  assert.deepEqual([tree.fileCount, tree.sizeBytes], [7, 3000 + 30 + 5 + 100 + 40 + 41 + 7]);
  const arcade = resolveExplorerLocation(tree, '_Arcade').folder;
  assert.deepEqual([arcade.fileCount, arcade.sizeBytes], [4, 3000 + 30 + 40 + 41]);

  // Where each comes from: the database's own files and folders, or an archive.
  const origins = (entry) => (entry.kind === 'folder' ? entry.origins : entry.versions).map(({ dbId, archiveId }) => `${dbId}:${archiveId}`);
  assert.deepEqual(origins(arcade), ['null:null']);
  assert.deepEqual(origins(resolveExplorerLocation(tree, '_Arcade/_alternatives').folder), ['null:mra_alternatives']);
  assert.deepEqual(origins(resolveExplorerLocation(tree, 'Cheats').folder), ['null:null', 'null:cheats_nes']);
  // A folder that only what it holds implies is declared nowhere.
  assert.deepEqual(origins(resolveExplorerLocation(tree, 'Cheats/NES').folder), []);
  const game = resolveExplorerLocation(tree, 'Cheats/NES/game.zip').file;
  assert.deepEqual(origins(game), ['null:cheats_nes']);
  assert.equal(game.sizeBytes, 7);
  assert.equal(game.versions[0].record.hash, 'cheat-nes');
});

test('the SD card is what the filter leaves, and a filter can empty it', async () => {
  const tree = buildExplorerTree(await view(ARCADE, '!arcade'));
  assert.deepEqual(listing(tree), [
    'D _Arcade',
    'D _Arcade/_alternatives',
    'D _Arcade/_alternatives/_Arkanoid',
    'F _Arcade/_alternatives/_Arkanoid/Arkanoid (Japan).mra',
    'F _Arcade/_alternatives/_Arkanoid/Arkanoid (US).mra',
    // A folder the database declares stays, empty, when the filter takes all it held.
    'D _Arcade/cores',
    'D Cheats',
    'D Cheats/MegaCD',
    'F Cheats/MegaCD/cheat.zip',
    'D Cheats/NES',
    'F Cheats/NES/game.zip',
    'F menu.rbf',
  ]);
  assert.deepEqual([tree.fileCount, tree.sizeBytes], [5, 40 + 41 + 5 + 7 + 100]);
  assert.equal(resolveExplorerLocation(tree, '_Arcade/cores').folder.fileCount, 0);
  // `_Arcade` itself is filtered out: only what it holds puts it there.
  assert.deepEqual(resolveExplorerLocation(tree, '_Arcade').folder.origins, []);

  const nothing = buildExplorerTree(await view(ARCADE, '!all'));
  assert.deepEqual(nothing.children, []);
  assert.deepEqual([nothing.fileCount, nothing.sizeBytes], [0, 0]);
});

test('a path installed twice is one file with both versions, identical or not', async () => {
  const twice = database('twice_db', {
    files: { 'games/same.bin': { size: 10, hash: 'same' }, 'games/other.bin': { size: 10, hash: 'one' }, 'games/unsized.bin': { hash: 'u' } },
    archives: {
      extras: archive('extras', 'games/', {
        'games/same.bin': { arc_id: 'extras', size: 10, hash: 'SAME' },
        'games/OTHER.bin': { arc_id: 'extras', size: 12, hash: 'two' },
      }),
    },
  });
  const tree = buildExplorerTree(await view(twice));
  const file = (path) => resolveExplorerLocation(tree, path).file;

  assert.deepEqual(listing(tree), ['D games', 'F games/other.bin', 'F games/same.bin', 'F games/unsized.bin']);
  assert.deepEqual(file('games/same.bin').versions.map(({ archiveId }) => archiveId), [null, 'extras']);
  assert.equal(file('games/same.bin').identical, true);
  assert.equal(file('games/other.bin').identical, false);
  // Its size is the largest version's; a file without one adds nothing.
  assert.equal(file('games/other.bin').sizeBytes, 12);
  assert.equal(file('games/unsized.bin').sizeBytes, null);
  assert.deepEqual([tree.fileCount, tree.sizeBytes], [3, 22]);
});

test('combined databases show a path several of them install once, with each database’s version', async () => {
  const alpha = database('alpha', {
    files: { 'cores/shared.rbf': { size: 1, hash: 'x' }, 'cores/alpha.rbf': { size: 2, hash: 'a' } },
    folders: { 'cores/': {} },
  });
  const beta = database('beta', {
    files: { 'cores/shared.rbf': { size: 3, hash: 'y' } },
    archives: { packs: archive('packs', 'cores/', { 'cores/beta.rbf': { arc_id: 'packs', size: 4, hash: 'b' } }) },
  });
  const combined = combineDatabaseViews([
    { dbId: 'alpha', view: await view(alpha) },
    { dbId: 'beta', view: await view(beta) },
  ]);
  const tree = buildExplorerTree(combined);

  assert.deepEqual(listing(tree), ['D cores', 'F cores/alpha.rbf', 'F cores/beta.rbf', 'F cores/shared.rbf']);
  const shared = resolveExplorerLocation(tree, 'cores/shared.rbf').file;
  assert.deepEqual(shared.versions.map(({ dbId, record }) => `${dbId}:${record.hash}`), ['alpha:x', 'beta:y']);
  assert.equal(shared.identical, false);
  assert.equal(shared.sizeBytes, 3);
  assert.deepEqual(resolveExplorerLocation(tree, 'cores/beta.rbf').file.versions.map(({ dbId, archiveId }) => `${dbId}:${archiveId}`), ['beta:packs']);
  assert.deepEqual(resolveExplorerLocation(tree, 'cores').folder.origins.map(({ dbId }) => dbId), ['alpha']);
  assert.deepEqual([tree.fileCount, tree.sizeBytes], [3, 2 + 4 + 3]);
});

test('a path leads to its folder, or to its file in its folder, ignoring letter case; a missing one to the deepest folder on its way', async () => {
  const tree = buildExplorerTree(await view(ARCADE));
  const where = (path) => {
    const { folder, file } = resolveExplorerLocation(tree, path);
    return [folder.path, file?.path ?? null];
  };

  assert.deepEqual(where(''), ['', null]);
  assert.deepEqual(where('_Arcade'), ['_Arcade', null]);
  assert.deepEqual(where('_arcade/CORES/'), ['_Arcade/cores', null]);
  assert.deepEqual(where('_Arcade/Arkanoid.mra'), ['_Arcade', '_Arcade/Arkanoid.mra']);
  assert.deepEqual(where('menu.rbf'), ['', 'menu.rbf']);
  assert.deepEqual(where('_Arcade/cores/missing.rbf'), ['_Arcade/cores', null]);
  assert.deepEqual(where('_Arcade/gone/deeper/file.rbf'), ['_Arcade', null]);
  assert.deepEqual(where('nowhere'), ['', null]);

  assert.deepEqual(
    explorerAncestors(resolveExplorerLocation(tree, '_Arcade/_alternatives/_Arkanoid').folder).map(({ name }) => name),
    ['SD card', '_Arcade', '_alternatives', '_Arkanoid'],
  );
});

test('Back and Forward go through the folders visited, and visiting another drops those ahead', () => {
  let history = startExplorerHistory('');
  assert.deepEqual(stepExplorerHistory(history, -1), history);
  history = visitExplorerFolder(history, '_Arcade');
  history = visitExplorerFolder(history, '_Arcade/cores');
  // Visiting the folder shown changes nothing.
  assert.equal(visitExplorerFolder(history, '_Arcade/cores'), history);
  assert.deepEqual(history, { paths: ['', '_Arcade', '_Arcade/cores'], index: 2 });

  history = stepExplorerHistory(history, -1);
  history = stepExplorerHistory(history, -1);
  assert.equal(history.index, 0);
  assert.equal(stepExplorerHistory(history, -1), history);
  history = stepExplorerHistory(history, 1);
  assert.deepEqual(history, { paths: ['', '_Arcade', '_Arcade/cores'], index: 1 });

  history = visitExplorerFolder(history, 'Cheats');
  assert.deepEqual(history, { paths: ['', '_Arcade', 'Cheats'], index: 2 });
  assert.equal(stepExplorerHistory(history, 1), history);
});

test('a row cut short keeps the end of a name: its extension and the nine characters before it', () => {
  assert.deepEqual(splitNameEnd('Arkanoid_20240525.rbf'), { start: 'Arkanoid', end: '_20240525.rbf' });
  assert.deepEqual(splitNameEnd('4D Warriors (315-5162).mra'), { start: '4D Warriors (', end: '315-5162).mra' });
  // Without an extension (or with one too long to be one), the last nine characters.
  assert.deepEqual(splitNameEnd('_alternatives_folder'), { start: '_alternativ', end: 'es_folder' });
  assert.deepEqual(splitNameEnd('archive.extension'), { start: 'archive.', end: 'extension' });
  // A short name is all end; characters outside the BMP stay whole.
  assert.deepEqual(splitNameEnd('cores'), { start: '', end: 'cores' });
  assert.deepEqual(splitNameEnd('😀😀😀😀😀😀😀😀😀😀😀😀.txt'), { start: '😀😀😀', end: '😀😀😀😀😀😀😀😀😀.txt' });
});

test('an icon’s name takes two lines, breaking between words, and a second line that does not fit keeps the end', () => {
  // One unit per character, ten to a line.
  const measure = (text) => Array.from(text).length;
  assert.deepEqual(splitTileName('cores', 10, measure), ['cores', '']);
  assert.deepEqual(splitTileName('720 Degrees (rev 4).mra', 13, measure), ['720 Degrees', '(rev 4).mra']);
  assert.deepEqual(splitTileName('4D Warriors (315-5162).mra', 13, measure), ['4D Warriors', '…15-5162).mra']);
  assert.deepEqual(splitTileName('APB - All Points Bulletin (rev 7).mra', 13, measure), ['APB - All', '… (rev 7).mra']);
  // A word longer than a line breaks inside it.
  assert.deepEqual(splitTileName('Supercalifragilistic.rbf', 10, measure), ['Supercalif', '…istic.rbf']);
  assert.deepEqual(splitTileName('A very long name with many words in it.mra', 12, measure), ['A very long', '…s in it.mra']);
});

test('only the lines in view render, with some more around them; before the list has a size, the first ones', () => {
  assert.deepEqual(explorerWindow({ scrollTop: 0, viewportHeight: 0, lineHeight: 40, lineCount: 4542 }), { start: 0, end: 40 });
  assert.deepEqual(explorerWindow({ scrollTop: 0, viewportHeight: 0, lineHeight: 40, lineCount: 3 }), { start: 0, end: 3 });
  assert.deepEqual(explorerWindow({ scrollTop: 0, viewportHeight: 400, lineHeight: 40, lineCount: 4542 }), { start: 0, end: 14 });
  assert.deepEqual(explorerWindow({ scrollTop: 4000, viewportHeight: 400, lineHeight: 40, lineCount: 4542 }), { start: 96, end: 114 });
  assert.deepEqual(explorerWindow({ scrollTop: 181280, viewportHeight: 400, lineHeight: 40, lineCount: 4542 }), { start: 4528, end: 4542 });
});

test('a selected line comes into view: scrolled up to, down to, or left where it is', () => {
  const box = { scrollTop: 400, viewportHeight: 200, lineHeight: 40 };
  assert.equal(revealExplorerLine({ ...box, line: 5 }), 200);
  assert.equal(revealExplorerLine({ ...box, line: 10 }), null);
  assert.equal(revealExplorerLine({ ...box, line: 14 }), null);
  assert.equal(revealExplorerLine({ ...box, line: 15 }), 440);
  // Before the list has a size, only lines above the top move it.
  assert.equal(revealExplorerLine({ ...box, viewportHeight: 0, line: 50 }), null);
});

test('the arrows, Home and End move the selection through the list, and through the icons by rows and columns', () => {
  const move = (index, key, columns) => moveExplorerSelection(index, key, 10, columns);
  // Nothing selected: the first entry.
  assert.equal(move(-1, 'ArrowDown'), 0);
  assert.equal(move(-1, 'ArrowLeft', 4), 0);
  assert.equal(move(3, 'ArrowDown'), 4);
  assert.equal(move(9, 'ArrowDown'), 9);
  assert.equal(move(0, 'ArrowUp'), 0);
  assert.equal(move(3, 'Home'), 0);
  assert.equal(move(3, 'End'), 9);
  // The list has no columns to move across.
  assert.equal(move(3, 'ArrowRight'), 3);
  // Four columns: down and up by a row, right and left by one.
  assert.equal(move(1, 'ArrowDown', 4), 5);
  assert.equal(move(7, 'ArrowDown', 4), 9);
  assert.equal(move(2, 'ArrowUp', 4), 2);
  assert.equal(move(6, 'ArrowUp', 4), 2);
  assert.equal(move(6, 'ArrowRight', 4), 7);
  assert.equal(move(9, 'ArrowRight', 4), 9);
  assert.equal(move(0, 'ArrowLeft', 4), 0);
  assert.equal(move(3, 'Enter'), null);
  assert.equal(moveExplorerSelection(-1, 'ArrowDown', 0), null);
});

test('the icons view is remembered in this browser, and the list is the view otherwise', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(readExplorerView(storage), 'list');
  storeExplorerView('icons', storage);
  assert.equal(values.get(EXPLORER_VIEW_STORAGE_KEY), 'icons');
  assert.equal(readExplorerView(storage), 'icons');
  storeExplorerView('list', storage);
  assert.equal(values.has(EXPLORER_VIEW_STORAGE_KEY), false);
  values.set(EXPLORER_VIEW_STORAGE_KEY, 'tiles');
  assert.equal(readExplorerView(storage), 'list');

  // Where the browser blocks storage, nothing is remembered and nothing fails.
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readExplorerView(blocked), 'list');
  assert.doesNotThrow(() => storeExplorerView('icons', blocked));
});
