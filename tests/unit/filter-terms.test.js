import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import { buildFilterTerms, searchFilterTerms, termUse, toggleTerm } from '../../src/lib/filterTerms.js';

async function inspect(db) {
  const source = await loadDatabaseSourceFile(new File([JSON.stringify(db)], `${db.db_id}.json`, { type: 'application/json' }));
  return { dbId: db.db_id, inspection: source.inspection };
}

function database(dbId, { files = {}, folders = {}, archives = {}, tag_dictionary } = {}) {
  return { db_id: dbId, v: 1, timestamp: 1710000000, base_files_url: `https://example.com/${dbId}/`, files, folders, archives, ...(tag_dictionary ? { tag_dictionary } : {}) };
}

// Each term as name (aliases) entries [databases].
function describe({ terms }) {
  return terms.map(({ name, aliases, entries, dbIds }) => `${name}${aliases.length ? ` (${aliases.join(', ')})` : ''} ${entries} [${dbIds.join(', ')}]`);
}

const CONSOLES = database('consoles_db', {
  tag_dictionary: { famicom: 0, nes: 0, nintendo: 0, arcade: 1, arcade_cores: 1, cheats: 2, unused_tag: 3, 'bad name': 4, none: 5 },
  files: {
    'games/NES/a.nes': { size: 1, hash: 'a', tags: [0] },
    'games/NES/b.nes': { size: 1, hash: 'b', tags: [0, 2] },
    // The same tag twice counts once.
    '_Arcade/x.mra': { size: 1, hash: 'x', tags: [1, 1] },
    // A tag written by its name, which the dictionary does not have.
    'docs/readme.txt': { size: 1, hash: 'r', tags: ['Docs'] },
    // A number the dictionary does not have, and names a FILTER cannot hold, are no terms.
    'odd.bin': { size: 1, hash: 'o', tags: [9] },
    'bad.bin': { size: 1, hash: 'p', tags: [4, 5] },
  },
  folders: { 'games/NES/': { tags: [0] } },
  archives: {
    cheats_nes: {
      description: 'Cheats',
      format: 'zip',
      extract: 'all',
      target_folder: 'cheats/',
      archive_file: { url: 'https://example.com/cheats.zip', size: 10, hash: 'zip' },
      summary_inline: {
        files: {
          'cheats/NES/one.zip': { arc_id: 'cheats_nes', size: 1, hash: 'c1', tags: [2] },
          'cheats/NES/two.zip': { arc_id: 'cheats_nes', size: 1, hash: 'c2', tags: [2] },
        },
        folders: {},
      },
    },
  },
});

test('a database’s terms: each tag once with all its names, the entries tagged with it, and the dictionary’s unused tags', async () => {
  const consoles = buildFilterTerms([await inspect(CONSOLES)]);
  assert.deepEqual(describe(consoles), [
    'arcade (arcade_cores) 1 [consoles_db]',
    // Files, folders and archive entries all count.
    'cheats 3 [consoles_db]',
    'Docs 1 [consoles_db]',
    // The shortest of a tag's names is the one written.
    'nes (famicom, nintendo) 3 [consoles_db]',
    'unused_tag 0 [consoles_db]',
  ]);
  assert.deepEqual(consoles.withoutTerms, []);
  // Its numbers in the dictionary, for database authors; a tag written by name has none.
  const byName = Object.fromEntries(consoles.terms.map((term) => [term.name, term]));
  assert.deepEqual(byName.nes.numbers, [{ dbId: 'consoles_db', number: 0 }]);
  assert.deepEqual(byName.Docs.numbers, []);
  assert.deepEqual([...byName.arcade.keys], ['arcade', 'arcadecores']);
});

test('combined databases share a term wherever their tags share a name, and the name most of them know it by is the one written', async () => {
  const alpha = database('alpha', { tag_dictionary: { famicom: 0, nes: 0, nintendo: 0 }, files: { 'a.nes': { size: 1, hash: 'a', tags: [0] } } });
  const beta = database('beta', { tag_dictionary: { nes: 0, snes: 1 }, files: { 'b.nes': { size: 1, hash: 'b', tags: [0] }, 'c.sfc': { size: 1, hash: 'c', tags: [1] } } });
  const gamma = database('gamma', { files: { 'readme.txt': { size: 1, hash: 'r' } } });
  const combined = buildFilterTerms([await inspect(alpha), await inspect(beta), await inspect(gamma)]);

  assert.deepEqual(describe(combined), ['nes (famicom, nintendo) 2 [alpha, beta]', 'snes 1 [beta]']);
  assert.deepEqual(combined.terms[0].numbers, [{ dbId: 'alpha', number: 0 }, { dbId: 'beta', number: 0 }]);
  // A database whose entries carry no tags has no terms.
  assert.deepEqual(combined.withoutTerms, ['gamma']);

  // fc is shorter, but both databases know the term as famicom.
  const shortName = database('short_name', { tag_dictionary: { fc: 0, famicom: 0 } });
  const longName = database('long_name', { tag_dictionary: { famicom: 0 } });
  const shared = buildFilterTerms([await inspect(shortName), await inspect(longName)]);
  assert.deepEqual(describe(shared), ['famicom (fc) 0 [short_name, long_name]']);
});

test('Keep writes a term, Exclude writes it with !, and choosing what is there takes it out; the other terms stay as written', async () => {
  const { terms } = buildFilterTerms([await inspect(CONSOLES)]);
  const nes = terms.find((term) => term.name === 'nes');
  const cheats = terms.find((term) => term.name === 'cheats');

  assert.equal(toggleTerm('', nes, 'kept'), 'nes');
  assert.equal(toggleTerm('[mister]  arcade', nes, 'kept'), '[mister] arcade nes');
  assert.equal(toggleTerm('[mister] arcade nes', cheats, 'excluded'), '[mister] arcade nes !cheats');
  // Again: out. The other way: swapped.
  assert.equal(toggleTerm('arcade nes !cheats', nes, 'kept'), 'arcade !cheats');
  assert.equal(toggleTerm('arcade nes !cheats', nes, 'excluded'), 'arcade !cheats !nes');
  // Any of its names, as FILTER compares them, is the term; all of them go.
  assert.equal(toggleTerm('Famicom n-e_s arcade', nes, 'kept'), 'arcade');
  assert.equal(toggleTerm('!NINTENDO', nes, 'kept'), 'nes');

  assert.deepEqual(termUse('arcade !famicom', nes), { kept: false, excluded: true });
  assert.deepEqual(termUse('nes !cheats', nes), { kept: true, excluded: false });
  assert.deepEqual(termUse('nes !nes', nes), { kept: true, excluded: true });
  assert.deepEqual(termUse('', cheats), { kept: false, excluded: false });
  assert.deepEqual(termUse('nesting cheatsheet', cheats), { kept: false, excluded: false });
});

test('the search finds terms by any of their names, as typed or as FILTER compares them', async () => {
  const { terms } = buildFilterTerms([await inspect(CONSOLES)]);
  const names = (query) => searchFilterTerms(terms, query).map(({ name }) => name);
  assert.equal(searchFilterTerms(terms, '  '), terms);
  assert.deepEqual(names('NIN'), ['nes']);
  assert.deepEqual(names('cores'), ['arcade']);
  assert.deepEqual(names('arcade-cores'), ['arcade']);
  assert.deepEqual(names('unused tag'), []);
  assert.deepEqual(names('unused_tag'), ['unused_tag']);
  assert.deepEqual(names('xyz'), []);
});
