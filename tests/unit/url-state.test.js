import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'fflate';

import {
  LINK_READABLE_MAX,
  buildExplorerAnchor,
  buildLinkUrl,
  buildTermsAnchor,
  buildNodeAnchor,
  formatLink,
  isCombinedLink,
  linkedDatabaseUrl,
  parseExplorerAnchor,
  parseLink,
  parseNodeAnchor,
  parseTermsAnchor,
  readLink,
  rewriteOldLink,
  writeLinkAnchor,
  writeLinkDatabase,
  writeLinkDetailed,
  writeLinkFilter,
  writeLinkSession,
} from '../../src/lib/urlState.js';
import { installBrowser } from './support/browser.js';

const UNSET = { isSet: false, value: '' };

function link(fields = {}) {
  return { databases: [], filter: UNSET, overrides: {}, detailed: false, at: '', ...fields };
}

// Keys packed as the app packs them: deflated, in base64url.
function pack(bytes) {
  return Buffer.from(deflateSync(bytes)).toString('base64url');
}

function withBrowser(href, run) {
  const browser = installBrowser(href);
  try {
    return run(browser.window);
  } finally {
    browser.restore();
  }
}

test('links are readable key=value pairs after the #, always in the same order', () => {
  const combined = link({
    databases: ['https://example.com/db.json.zip', 'https://example.com/coinop.json'],
    filter: { isSet: true, value: 'arcade !cheats' },
    overrides: { 'Coin-Op/Collection': '[mister] !beta', jtcores: '' },
    detailed: true,
    at: 'archives:jtcores:cheats:files:Cheats/a b.zip',
  });

  const fragment = formatLink(combined);
  assert.equal(
    fragment,
    'db=https://example.com/db.json.zip&db=https://example.com/coinop.json&filter=arcade+!cheats' +
      '&filter.Coin-Op/Collection=[mister]+!beta&filter.jtcores=&detailed&at=archives:jtcores:cheats:files:Cheats/a+b.zip',
  );
  assert.deepEqual(parseLink(fragment), { ...combined, error: '' });

  // The same link in another order reads the same.
  assert.deepEqual(
    parseLink('at=archives:jtcores:cheats:files:Cheats/a+b.zip&detailed&filter.jtcores=&filter=arcade+!cheats' +
      '&db=https://example.com/db.json.zip&filter.Coin-Op/Collection=[mister]+!beta&db=https://example.com/coinop.json'),
    { ...combined, overrides: { jtcores: '', 'Coin-Op/Collection': '[mister] !beta' }, error: '' },
  );
  assert.equal(formatLink(link()), '');
});

test('only what would break the link is escaped, and everything reads back', () => {
  const value = 'a%b&c+d=e#f g\th\n"<>`é日本🎮!$\'()*,-./:;?@[\\]^_{|}~';
  const fragment = formatLink(link({ filter: { isSet: true, value } }));

  assert.equal(
    fragment,
    'filter=a%25b%26c%2Bd%3De%23f+g%09h%0A%22%3C%3E%60%C3%A9%E6%97%A5%E6%9C%AC%F0%9F%8E%AE!$\'()*,-./:;?@[\\]^_{|}~',
  );
  assert.equal(parseLink(fragment).filter.value, value);
  // A lone surrogate, which cannot be escaped, is written as a replacement character.
  assert.equal(parseLink(formatLink(link({ filter: { isSet: true, value: 'a\uD800b' } }))).filter.value, 'a\uFFFDb');
  // Keys are escaped too.
  assert.deepEqual(parseLink(formatLink(link({ overrides: { 'odd=id&x': 'y' } }))).overrides, { 'odd=id&x': 'y' });
});

test('links read like a query string: + is a space, %XX an escape, and unknown keys are ignored', () => {
  assert.deepEqual(
    parseLink('db=https%3A%2F%2Fexample.com%2Fa.json&db=&Filter=x&utm_source=chat&filter=a+%21b%20c&filter.=x&detailed=no&at=files:x%2By'),
    link({
      databases: ['https://example.com/a.json'],
      filter: { isSet: true, value: 'a !b c' },
      detailed: true,
      at: 'files:x+y',
      error: '',
    }),
  );
  // A FILTER in the link, even an empty one, replaces the default; without one, defaults apply.
  assert.deepEqual(parseLink('db=a&filter=').filter, { isSet: true, value: '' });
  assert.deepEqual(parseLink('db=a').filter, UNSET);
  // Broken escapes are kept as they are, not thrown.
  assert.equal(parseLink('at=files:100%&db=%E0%A4%A').at, 'files:100%');
  assert.deepEqual(parseLink(''), { ...link(), error: '' });
});

test('long links are packed into z, with the anchor left readable, and read back the same', () => {
  const base = 'https://theypsilon.github.io/DB-Inspector_MiSTer/';
  const urls = Array.from({ length: 40 }, (_, index) => `https://raw.githubusercontent.com/example/db_${index}/db/db.json.zip`);
  const big = link({
    databases: urls,
    filter: { isSet: true, value: 'arcade' },
    overrides: { db_3: '[mister] !cheats' },
    detailed: true,
    at: 'files:games/a b.rom',
  });

  const fragment = formatLink(big, base);
  assert.match(fragment, /^z=[A-Za-z0-9_-]+&at=files:games\/a\+b\.rom$/);
  assert.ok(base.length + 1 + fragment.length < LINK_READABLE_MAX, `${fragment.length}`);
  assert.deepEqual(parseLink(fragment), { ...big, error: '' });

  // Short links stay readable: up to LINK_READABLE_MAX characters in all.
  const fits = link({ databases: [`https://example.com/${'a'.repeat(LINK_READABLE_MAX - base.length - 1 - 'db=https://example.com/'.length)}`] });
  assert.equal(`${base}#${formatLink(fits, base)}`.length, LINK_READABLE_MAX);
  assert.match(formatLink(fits, base), /^db=/);
  const longer = link({ databases: [...fits.databases, ...fits.databases] });
  assert.match(formatLink(longer, base), /^z=/);
  assert.deepEqual(parseLink(formatLink(longer, base)).databases, longer.databases);

  // What packing would make longer stays readable: characters written as they are, in no order.
  const kept = "!$'()*,-./0123456789:;?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~";
  const noise = Array.from({ length: 2500 }, (_, index) => kept[createHash('sha256').update(String(index)).digest()[0] % kept.length]).join('');
  assert.equal(formatLink(link({ databases: [`https://example.com/${noise}`] }), base), `db=https://example.com/${noise}`);
});

test('packed keys read as if they were written in their place, and z is not packed again', () => {
  const packed = pack(new TextEncoder().encode('db=https://example.com/a.json&filter=arcade&z=nested'));
  assert.deepEqual(
    parseLink(`z=${packed}&db=https://example.com/b.json&at=issues`),
    link({
      databases: ['https://example.com/a.json', 'https://example.com/b.json'],
      filter: { isSet: true, value: 'arcade' },
      at: 'issues',
      error: '',
    }),
  );
});

test('a damaged link says so instead of failing, and keeps what it could read', () => {
  const damaged = [
    'not base64!',
    'A',
    pack(new TextEncoder().encode('db=https://example.com/a.json')).slice(0, -4),
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64url'),
    // Not text.
    pack(new Uint8Array([0xff, 0xfe, 0xfd])),
    // Unpacks to more than any link holds.
    pack(new Uint8Array(2 << 20).fill(0x61)),
  ];

  for (const data of damaged) {
    const read = parseLink(`z=${data}&at=issues`);
    assert.equal(read.error, 'This link is damaged, so what it names could not be opened.', data.slice(0, 20));
    assert.deepEqual(read.databases, []);
    assert.equal(read.at, 'issues');
  }
});

test('one database is shown alone unless the link gives it its own filter; several are combined', () => {
  const one = parseLink('db=https://example.com/a.json&filter=arcade');
  assert.equal(isCombinedLink(one), false);
  assert.equal(linkedDatabaseUrl(one), 'https://example.com/a.json');

  // The only one of combined databases that could be shared keeps the filter it had as its own.
  const onlyShared = parseLink('db=https://example.com/a.json&filter=arcade&filter.alpha=arcade+!cheats');
  assert.equal(isCombinedLink(onlyShared), true);
  assert.equal(linkedDatabaseUrl(onlyShared), '');

  const several = parseLink('db=https://example.com/a.json&db=https://example.com/b.json');
  assert.equal(isCombinedLink(several), true);
  assert.equal(linkedDatabaseUrl(several), '');

  assert.equal(isCombinedLink(parseLink('filter=arcade&filter.alpha=x')), false);
  assert.equal(linkedDatabaseUrl(parseLink('filter=arcade')), '');
});

const ROW_ANCHORS = [
  [{ type: 'archive', id: 'archive:cheats_folder_nes' }, 'archives:cheats_folder_nes'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:file:Cheats/NES/a b.zip' }, 'archives:cheats_folder_nes:files:Cheats/NES/a b.zip'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:folder:Cheats/NES' }, 'archives:cheats_folder_nes:folders:Cheats/NES'],
  [{ type: 'node', id: 'archive:cheats_folder_nes:missingfolder:Cheats' }, 'archives:cheats_folder_nes:folders:Cheats'],
  [{ type: 'node', id: 'database:file:_Arcade/Pac Man.mra' }, 'files:_Arcade/Pac Man.mra'],
  [{ type: 'node', id: 'database:folder:_Arcade/cores' }, 'folders:_Arcade/cores'],
  [{ type: 'node', id: 'database:missingfolder:games' }, 'folders:games'],
];

test('every row kind gets an anchor', () => {
  for (const [row, anchor] of ROW_ANCHORS) {
    assert.equal(buildNodeAnchor(row), anchor, row.id);
  }
  assert.equal(buildNodeAnchor({ type: 'node', id: 'unexpected:row' }), null);
});

test('anchors lead back to their row, in the right section, through the link', () => {
  for (const [row, anchor] of ROW_ANCHORS) {
    const { at } = parseLink(formatLink(link({ at: anchor })));
    const found = parseNodeAnchor(at);
    const section = row.id.startsWith('archive:') ? 'archives' : 'filesystem';
    assert.equal(found.section, section, anchor);
    // Folder anchors also match folders the database lists without defining them.
    assert.ok(found.rowId === row.id || found.altRowId === row.id, anchor);
  }
});

test('anchors that name no row are left to the sections, the install dialog and the explorer', () => {
  for (const at of ['', 'install', 'filter', 'issues', 'files', 'archives', 'archives:', 'unknown:thing', 'explorer', 'explorer:_Arcade/cores', 'terms', 'terms:beta', 'terms?arcade', 'tags']) {
    assert.equal(parseNodeAnchor(at), null, at);
  }
});

test('the filter terms’ anchor names FILTER’s terms or a database’s own filter’s, with the search, and reads back through the link', () => {
  for (const [dbId, search, anchor] of [
    [null, '', 'terms'],
    ['jtcores', '', 'terms:jtcores'],
    // db_ids can hold a slash or a colon: the rest of the anchor, up to a ?, is the db_id.
    ['Coin-OpCollection/Distribution-MiSTerFPGA', '', 'terms:Coin-OpCollection/Distribution-MiSTerFPGA'],
    ['odd:id', '', 'terms:odd:id'],
    [null, 'arcade', 'terms?arcade'],
    ['Coin-OpCollection/Distribution-MiSTerFPGA', 'cheats', 'terms:Coin-OpCollection/Distribution-MiSTerFPGA?cheats'],
    // Everything after the first ? is the search, whatever it holds.
    ['odd:id', 'a?b&c=d+e #f:ü', 'terms:odd:id?a?b&c=d+e #f:ü'],
  ]) {
    assert.equal(buildTermsAnchor(dbId, search), anchor);
    const { at } = parseLink(formatLink(link({ databases: ['https://example.com/db.json'], at: anchor })));
    assert.deepEqual(parseTermsAnchor(at), { dbId, search }, anchor);
  }
  assert.equal(formatLink(link({ at: buildTermsAnchor() })), 'at=terms');
  assert.equal(formatLink(link({ at: buildTermsAnchor(null, 'arcade games') })), 'at=terms?arcade+games');
  // The search as it is compared: an empty or blank one is no search, and a search's ends are not kept.
  assert.equal(buildTermsAnchor(null, '   '), 'terms');
  assert.equal(buildTermsAnchor('beta', ' arcade '), 'terms:beta?arcade');
  assert.deepEqual(parseTermsAnchor('terms?'), { dbId: null, search: '' });
  // The section that listed the terms before named them `tags`.
  assert.deepEqual(parseTermsAnchor('tags'), { dbId: null, search: '' });
  for (const at of ['', 'terms:', 'terms:?arcade', 'tags:beta', 'termsx', 'termsx?arcade', 'filter', 'explorer']) {
    assert.equal(parseTermsAnchor(at), null, at);
  }
});

test('the explorer’s anchor names the SD card, a folder or a file, and reads back through the link', () => {
  for (const [path, anchor] of [
    ['', 'explorer'],
    ['_Arcade', 'explorer:_Arcade'],
    ['_Arcade/720 Degrees (rev 4).mra', 'explorer:_Arcade/720 Degrees (rev 4).mra'],
    ['games/a&b=c+d #1/ü.rom', 'explorer:games/a&b=c+d #1/ü.rom'],
  ]) {
    assert.equal(buildExplorerAnchor(path), anchor);
    const { at } = parseLink(formatLink(link({ databases: ['https://example.com/db.json'], at: anchor })));
    assert.equal(parseExplorerAnchor(at), path, anchor);
  }
  assert.equal(formatLink(link({ at: buildExplorerAnchor('_Arcade/720 Degrees (rev 4).mra') })), 'at=explorer:_Arcade/720+Degrees+(rev+4).mra');
  // An empty path is the SD card, and a trailing slash names the same folder.
  assert.equal(parseExplorerAnchor('explorer:'), '');
  assert.equal(parseExplorerAnchor('explorer:_Arcade/cores/'), '_Arcade/cores');
  for (const at of ['', 'install', 'files:_Arcade', 'explorers', 'explorer_x:a']) {
    assert.equal(parseExplorerAnchor(at), null, at);
  }
});

test('combined databases put the database of an archive in its anchor, and collided paths get their own', () => {
  const dbIds = ['jtcores', 'odd', 'Coin-Op/Collection', 'odd:db'];
  const rows = [
    [{ type: 'archive', id: 'archive[jtcores]:cheats' }, 'archives:jtcores:cheats', 'archives'],
    [{ type: 'node', id: 'archive[jtcores]:cheats:file:Cheats/a.zip' }, 'archives:jtcores:cheats:files:Cheats/a.zip', 'archives'],
    [{ type: 'node', id: 'archive[jtcores]:cheats:missingfolder:Cheats' }, 'archives:jtcores:cheats:folders:Cheats', 'archives'],
    [{ type: 'archive', id: 'archive[Coin-Op/Collection]:bios' }, 'archives:Coin-Op/Collection:bios', 'archives'],
    // The longest db_id that fits wins, as db_ids can hold a colon.
    [{ type: 'node', id: 'archive[odd:db]:pack:file:a.zip' }, 'archives:odd:db:pack:files:a.zip', 'archives'],
    [{ type: 'node', id: 'collision:games/nes/mario.nes' }, 'collisions:games/nes/mario.nes', 'collisions'],
  ];

  for (const [row, anchor, section] of rows) {
    assert.equal(buildNodeAnchor(row), anchor, row.id);
    const found = parseNodeAnchor(anchor, dbIds);
    assert.equal(found.section, section, anchor);
    assert.ok(found.rowId === row.id || found.altRowId === row.id, anchor);
  }

  assert.equal(buildNodeAnchor({ type: 'node', id: 'collision-version:1:games/nes/mario.nes' }), 'collisions:games/nes/mario.nes');
  // An archive anchor of a database that is not loaded names no row.
  assert.equal(parseNodeAnchor('archives:other:cheats', dbIds), null);
});

test('old links open their database as #db=, and nothing else of them is kept', () => {
  withBrowser(
    'https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url=https%3A%2F%2Fexample.com%2Fdb.json&filter=arcade&detailed#files:a.rbf',
    (window) => {
      rewriteOldLink();
      assert.equal(window.location.href, 'https://theypsilon.github.io/DB-Inspector_MiSTer/#db=https://example.com/db.json');
      assert.equal(window.history.length, 1);
    },
  );

  for (const href of [
    'https://theypsilon.github.io/DB-Inspector_MiSTer/?database-url[alpha]=https%3A%2F%2Fexample.com%2Fa.json',
    'https://theypsilon.github.io/DB-Inspector_MiSTer/?filter=arcade#issues',
    'https://theypsilon.github.io/DB-Inspector_MiSTer/#db=https://example.com/db.json',
  ]) {
    withBrowser(href, (window) => {
      rewriteOldLink();
      assert.equal(window.location.href, href);
    });
  }
});

test('writing the link changes only what it says, in a new history entry only when asked to', () => {
  withBrowser('https://example.com/app/?ref=chat', (window) => {
    writeLinkDatabase('https://example.com/a.json', { pushHistory: true });
    writeLinkDatabase('https://example.com/a.json', { pushHistory: true });
    assert.equal(window.location.href, 'https://example.com/app/?ref=chat#db=https://example.com/a.json');
    assert.equal(window.history.length, 2);

    writeLinkFilter('arcade !cheats');
    writeLinkDetailed(true);
    writeLinkAnchor('files:games/a.rom');
    assert.equal(window.location.hash, '#db=https://example.com/a.json&filter=arcade+!cheats&detailed&at=files:games/a.rom');
    assert.equal(buildLinkUrl({ at: 'install' }), 'https://example.com/app/?ref=chat#db=https://example.com/a.json&filter=arcade+!cheats&detailed&at=install');

    // Combined databases replace the database alone, and a database alone replaces them and their
    // own filters, keeping FILTER unless told not to.
    writeLinkSession(
      { databases: ['https://example.com/a.json', 'https://example.com/b.json'], filter: { isSet: true, value: 'arcade' }, overrides: { beta: 'console' } },
      { pushHistory: true },
    );
    assert.equal(
      window.location.hash,
      '#db=https://example.com/a.json&db=https://example.com/b.json&filter=arcade&filter.beta=console&detailed&at=files:games/a.rom',
    );
    writeLinkDatabase('https://example.com/b.json', { pushHistory: true, preserveFilter: false });
    assert.equal(window.location.hash, '#db=https://example.com/b.json&detailed&at=files:games/a.rom');
    assert.equal(window.history.length, 4);

    writeLinkFilter('', { isPresent: false });
    writeLinkDetailed(false);
    writeLinkAnchor('');
    writeLinkDatabase('');
    assert.equal(window.location.href, 'https://example.com/app/?ref=chat');
    assert.equal(window.history.length, 4);
  });
});

test('a damaged link is replaced by the next write, even one that changes nothing it could read', () => {
  withBrowser('https://example.com/#z=damaged!&detailed', (window) => {
    assert.match(readLink().error, /damaged/);
    writeLinkDetailed(true);
    assert.equal(window.location.hash, '#detailed');
    assert.equal(readLink().error, '');
  });
});
