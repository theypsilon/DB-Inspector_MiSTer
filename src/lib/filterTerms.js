import { normalizeTagName } from './database.js';

// The terms a FILTER can use: the tags of the databases it applies to, one term for each tag with
// every name it has (a tag dictionary can give one tag several names, such as famicom, nes and
// nintendo), merged across databases where tags share a name, since a FILTER term matches every
// tag with that name. Each term counts the files, folders and archive entries tagged with it,
// before any filter, and names the databases that have it.

/**
 * @typedef {object} FilterTerm
 * @property {string} id
 * @property {string} name The name choosing the term writes in FILTER.
 * @property {string[]} aliases Its other names.
 * @property {Set<string>} keys Its names as FILTER compares them (see normalizeTagName).
 * @property {number} entries The entries tagged with it, before any filter.
 * @property {string[]} dbIds The databases that have it, in their order.
 * @property {{ dbId: string, number: number }[]} numbers Its number in each database's tag dictionary.
 */

// What Downloader accepts as a term (see parseDownloaderFilter): a tag whose names are none of
// these cannot be written in a FILTER, so it is not a term.
const TERM_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

function isTermName(name) {
  return TERM_NAME.test(name) && normalizeTagName(name) !== 'none';
}

/**
 * The terms of `databases` ([{ dbId, inspection }], in order, each inspection before its filter),
 * by name, and the databases that have none.
 * @param {{ dbId: string, inspection: any }[]} databases
 * @returns {{ terms: FilterTerm[], withoutTerms: string[] }}
 */
export function buildFilterTerms(databases) {
  const tags = [];
  const withoutTerms = [];

  for (const { dbId, inspection } of databases) {
    // A database's tags, by what its entries name them with: a dictionary number, or a name.
    const byKey = new Map();
    const tagFor = (key, names) => {
      let tag = byKey.get(key);
      if (!tag) {
        const number = key.startsWith('index:') ? Number(key.slice('index:'.length)) : null;
        tag = { dbId, names: [], entries: 0, number: Number.isFinite(number) ? number : null };
        byKey.set(key, tag);
      }
      for (const name of names) {
        if (!tag.names.includes(name)) {
          tag.names.push(name);
        }
      }
      return tag;
    };

    const records = [
      ...(inspection.filesystemRecords ?? []),
      ...(inspection.archiveViews ?? []).flatMap((archive) => archive.summaryRecords ?? []),
    ];
    for (const record of records) {
      const field = record.primaryFields?.find((candidate) => candidate.kind === 'tags');
      const seen = new Set();
      for (const tag of Array.isArray(field?.value) ? field.value : []) {
        if (!seen.has(tag.key)) {
          seen.add(tag.key);
          tagFor(tag.key, tag.names ?? [tag.label]).entries += 1;
        }
      }
    }
    // The dictionary's tags nothing is tagged with are terms too.
    for (const { name, index } of inspection.overview?.tagDictionary ?? []) {
      tagFor(`index:${Number(index)}`, [name]);
    }

    const usable = [...byKey.values()].filter((tag) => tag.names.some(isTermName));
    if (!usable.length) {
      withoutTerms.push(dbId);
    }
    tags.push(...usable);
  }

  // Tags of different databases that share a name are one term.
  const parents = tags.map((_, index) => index);
  const root = (index) => (parents[index] === index ? index : (parents[index] = root(parents[index])));
  const firstWithKey = new Map();
  tags.forEach((tag, index) => {
    for (const name of tag.names) {
      const key = normalizeTagName(name);
      if (firstWithKey.has(key)) {
        parents[root(index)] = root(firstWithKey.get(key));
      } else {
        firstWithKey.set(key, index);
      }
    }
  });

  const merged = new Map();
  tags.forEach((tag, index) => {
    const group = merged.get(root(index)) ?? [];
    group.push(tag);
    merged.set(root(index), group);
  });

  const terms = [...merged.values()].map(buildTerm);
  terms.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  return { terms, withoutTerms };
}

function buildTerm(tags) {
  // Every name once, as FILTER compares them, in the order they were met.
  const names = [];
  const keys = new Set();
  for (const tag of tags) {
    for (const name of tag.names) {
      const key = normalizeTagName(name);
      if (!keys.has(key)) {
        keys.add(key);
        names.push(name);
      }
    }
  }

  // The name written is the one most of its databases know it by, else the shortest (nes rather
  // than famicom or nintendo), else the first met.
  const databasesWith = (name) => new Set(tags.filter((tag) => tag.names.some((other) => normalizeTagName(other) === normalizeTagName(name))).map((tag) => tag.dbId)).size;
  const better = (candidate, best) => {
    const difference = databasesWith(candidate) - databasesWith(best);
    return difference > 0 || (difference === 0 && candidate.length < best.length);
  };
  const name = names.filter(isTermName).reduce((best, candidate) => (better(candidate, best) ? candidate : best));

  return {
    id: normalizeTagName(name),
    name,
    aliases: names.filter((other) => other !== name),
    keys,
    entries: tags.reduce((sum, tag) => sum + tag.entries, 0),
    dbIds: [...new Set(tags.map((tag) => tag.dbId))],
    numbers: tags.filter((tag) => tag.number !== null).map(({ dbId, number }) => ({ dbId, number })),
  };
}

// How a FILTER uses a term: kept (a positive term names it), excluded (a negative one does).
/**
 * @param {string} filter
 * @param {FilterTerm} term
 */
export function termUse(filter, term) {
  const use = { kept: false, excluded: false };
  for (const token of tokens(filter)) {
    const named = namedTerm(token, term);
    if (named) {
      use[named] = true;
    }
  }
  return use;
}

/**
 * The FILTER with a term kept or excluded, or, when it is already, without it. Its other terms
 * stay as written, in their order; the term goes at the end.
 * @param {string} filter
 * @param {FilterTerm} term
 * @param {'kept' | 'excluded'} use
 */
export function toggleTerm(filter, term, use) {
  const all = tokens(filter);
  const wasUsed = all.some((token) => namedTerm(token, term) === use);
  const others = all.filter((token) => !namedTerm(token, term));
  if (!wasUsed) {
    others.push(use === 'excluded' ? `!${term.name}` : term.name);
  }
  return others.join(' ');
}

function tokens(filter) {
  return String(filter ?? '').split(/\s+/).filter(Boolean);
}

function namedTerm(token, term) {
  const excluded = token.startsWith('!');
  if (!term.keys.has(normalizeTagName(excluded ? token.slice(1) : token))) {
    return null;
  }
  return excluded ? 'excluded' : 'kept';
}

/**
 * The terms whose names hold `query`, as typed or as FILTER compares them.
 * @param {FilterTerm[]} terms
 * @param {string} query
 */
export function searchFilterTerms(terms, query) {
  const typed = query.trim().toLowerCase();
  if (!typed) {
    return terms;
  }

  const compared = normalizeTagName(typed);
  return terms.filter(
    (term) =>
      [term.name, ...term.aliases].some((name) => name.toLowerCase().includes(typed)) ||
      (compared !== '' && [...term.keys].some((key) => key.includes(compared))),
  );
}
