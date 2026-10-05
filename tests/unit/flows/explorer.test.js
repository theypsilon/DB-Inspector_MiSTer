import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { openApp } from '../support/app.js';
import { getImagePreviewUrl } from '../../../src/lib/downloads.js';
import { buildExplorerTree, resolveExplorerLocation } from '../../../src/lib/explorer.js';
import { parseExplorerAnchor, readLink } from '../../../src/lib/urlState.js';

// The explorer over databases opened as the page opens them: what it shows is the SD card the
// databases on the page install, with their filters, and the link can name where it opens. The
// dialog itself (clicks, keys, the link it writes) is in the component tests and the journeys.

const DB_URL = 'https://example.com/sd/db.json';
const SUMMARY_URL = 'https://example.com/sd/cheats_summary.json';
const OTHER_URL = 'https://example.com/other/db.json';

const DATABASE = {
  db_id: 'sd_db',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/sd/files/',
  tag_dictionary: { cheats: 0, arcade: 1 },
  files: {
    'Cheats/MegaCD/a.zip': { size: 5, hash: 'a', tags: [0] },
    '_Arcade/x.mra': { size: 3, hash: 'x', tags: [1] },
  },
  folders: { 'Cheats/': {}, '_Arcade/': {} },
  archives: {
    cheats_nes: {
      description: 'NES cheats',
      format: 'zip',
      extract: 'all',
      target_folder: 'Cheats/',
      archive_file: { url: 'https://example.com/sd/cheats_nes.zip', size: 100, hash: 'zip' },
      // As Distribution_MiSTer's archives, its summary is a file of its own.
      summary_file: { url: 'cheats_summary.json', size: 1, hash: 'h' },
    },
  },
};
const SUMMARY = {
  files: { 'Cheats/NES/game.zip': { arc_id: 'cheats_nes', size: 7, hash: 'g', tags: [0] } },
  folders: { 'Cheats/NES/': { arc_id: 'cheats_nes' } },
};
const OTHER = {
  db_id: 'other_db',
  v: 1,
  timestamp: 1710000000,
  base_files_url: 'https://example.com/other/files/',
  files: { 'Cheats/NES/game.zip': { size: 9, hash: 'other' }, 'Cheats/NES/extra.zip': { size: 2, hash: 'e' } },
  folders: {},
};
const ROUTES = { [DB_URL]: { body: DATABASE }, [SUMMARY_URL]: { body: SUMMARY }, [OTHER_URL]: { body: OTHER } };

let app;
afterEach(() => app?.close());

// The SD card of what the page shows, as the explorer builds it.
function sdCard() {
  return buildExplorerTree(app.view.combined ?? app.view.inspection);
}

function names(folder) {
  return folder.children.map(({ name }) => name);
}

test('a link opens the explorer where it says, on the SD card the database and its archives install', async () => {
  app = await openApp(`/#db=${DB_URL}&at=explorer:Cheats/NES/game.zip`, { routes: ROUTES });
  assert.equal(app.view.heading, 'sd_db');

  const tree = sdCard();
  assert.deepEqual(names(tree), ['_Arcade', 'Cheats']);
  // The archive's files are next to the database's own, in the folder they install to.
  assert.deepEqual(names(resolveExplorerLocation(tree, 'Cheats').folder), ['MegaCD', 'NES']);

  const { folder, file } = resolveExplorerLocation(tree, parseExplorerAnchor(readLink().at));
  assert.equal(folder.path, 'Cheats/NES');
  assert.equal(file.path, 'Cheats/NES/game.zip');
  assert.deepEqual(file.versions.map(({ archiveId }) => archiveId), ['cheats_nes']);
  // The link keeps the anchor while the database loads and FILTER settles.
  assert.equal(app.hash, `#db=${DB_URL}&at=explorer:Cheats/NES/game.zip`);
});

test('the explorer shows what FILTER leaves', async () => {
  app = await openApp(`/#db=${DB_URL}`, { routes: ROUTES });
  assert.deepEqual(names(resolveExplorerLocation(sdCard(), '_Arcade').folder), ['x.mra']);

  await app.typeFilter('!arcade');
  const filtered = sdCard();
  assert.deepEqual(names(resolveExplorerLocation(filtered, '_Arcade').folder), []);
  assert.deepEqual([filtered.fileCount, filtered.sizeBytes], [2, 12]);
  // A link to what the filter hides opens the deepest folder still there.
  assert.equal(resolveExplorerLocation(filtered, '_Arcade/x.mra').folder.path, '_Arcade');
});

test('an image file’s details preview it from its URL, whatever the letter case of its extension; other files, and files without a URL, have none', async () => {
  const imagesUrl = 'https://example.com/images/db.json';
  const images = {
    db_id: 'images_db',
    v: 1,
    timestamp: 1710000000,
    base_files_url: 'https://example.com/images/files/',
    files: {
      'docs/NEOGEO/Titles/fswords.png': { size: 15900, hash: 'a' },
      'docs/photo.JPEG': { size: 1, hash: 'b', url: 'https://cdn.example.com/photo.JPEG' },
      'docs/logo.svg': { size: 1, hash: 'c' },
      'docs/gameinfo.tsv': { size: 1, hash: 'd' },
      'docs/png': { size: 1, hash: 'e' },
    },
    folders: {},
  };
  // Without base_files_url, a file without its own url has no URL.
  const bare = { db_id: 'bare_db', v: 1, timestamp: 1710000000, files: { 'docs/cover.png': { size: 1, hash: 'f' } }, folders: {} };
  const bareUrl = 'https://example.com/bare/db.json';
  app = await openApp(`/#db=${imagesUrl}`, { routes: { [imagesUrl]: { body: images } } });
  const preview = (path) => getImagePreviewUrl(resolveExplorerLocation(sdCard(), path).file.versions[0].record);

  assert.equal(preview('docs/NEOGEO/Titles/fswords.png'), 'https://example.com/images/files/docs/NEOGEO/Titles/fswords.png');
  assert.equal(preview('docs/photo.JPEG'), 'https://cdn.example.com/photo.JPEG');
  assert.equal(preview('docs/logo.svg'), 'https://example.com/images/files/docs/logo.svg');
  assert.equal(preview('docs/gameinfo.tsv'), null);
  assert.equal(preview('docs/png'), null);

  await app.close();
  app = await openApp(`/#db=${bareUrl}`, { routes: { [bareUrl]: { body: bare } } });
  assert.equal(preview('docs/cover.png'), null);
});

test('combined databases fill the same folders, and a path both install shows once with each version', async () => {
  app = await openApp(`/#db=${DB_URL}&db=${OTHER_URL}`, { routes: ROUTES });
  assert.equal(app.view.heading, '2 combined databases');

  const nes = resolveExplorerLocation(sdCard(), 'Cheats/NES').folder;
  assert.deepEqual(names(nes), ['extra.zip', 'game.zip']);
  const game = nes.children[1];
  assert.deepEqual(game.versions.map(({ dbId, archiveId }) => `${dbId}:${archiveId}`), ['sd_db:cheats_nes', 'other_db:null']);
  assert.equal(game.sizeBytes, 9);
  // The same path is listed under Path collisions.
  assert.deepEqual(app.view.collisions, ['game.zip', 'game.zip', 'game.zip']);
});
