import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { findGitHubReleaseDownload, findGitHubReleaseDownloads, loadDatabaseSourceUrl } from '../../src/lib/database.js';

const DEGAUSS = 'https://github.com/giancarloerra/Degauss/releases/latest/download/degauss.json.zip';
const TAGGED = 'https://github.com/owner/repo/releases/download/v1.0.0/db.json';
const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
});

// A fetch that records each request and answers it as `respond` says.
function recordingFetch(requests, respond) {
  return async (url, init) => {
    requests.push({ url: String(url), init });
    return respond(String(url));
  };
}

test('GitHub release downloads are recognized, the latest or by tag', () => {
  assert.deepEqual(findGitHubReleaseDownload(DEGAUSS), { url: DEGAUSS, fileName: 'degauss.json.zip' });
  assert.deepEqual(findGitHubReleaseDownload(TAGGED), { url: TAGGED, fileName: 'db.json' });
  assert.deepEqual(findGitHubReleaseDownload('https://www.github.com/owner/repo/releases/download/v2/my%20db.json'), {
    url: 'https://www.github.com/owner/repo/releases/download/v2/my%20db.json',
    fileName: 'my db.json',
  });

  for (const url of [
    'https://raw.githubusercontent.com/owner/repo/main/db.json',
    'https://github.com/owner/repo/raw/main/db.json',
    'https://github.com/owner/repo/releases/tag/v1.0.0',
    'https://github.com/owner/repo/releases/download/v1.0.0/',
    'http://github.com/owner/repo/releases/download/v1.0.0/db.json',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/2',
    'not a url',
  ]) {
    assert.equal(findGitHubReleaseDownload(url), null, url);
  }
});

const PROXY = 'https://gh-proxy.com/';
const releaseError = (url, fileName) =>
  `GitHub does not let websites read release downloads, so ${url} cannot be opened in the browser. Download ${fileName} and drag it into Upload to inspect it.`;
const failToFetch = () => {
  throw new TypeError('Failed to fetch');
};

test('a release download the browser cannot read, nor gh-proxy.com give, says why, and how to inspect it anyway', async () => {
  const requests = [];
  globalThis.fetch = recordingFetch(requests, failToFetch);

  await assert.rejects(loadDatabaseSourceUrl(DEGAUSS), { message: releaseError(DEGAUSS, 'degauss.json.zip') });
  await assert.rejects(loadDatabaseSourceUrl('https://example.com/db.json'), {
    message: 'Could not open https://example.com/db.json in the browser. The website may block direct access or be temporarily unavailable.',
  });
  // gh-proxy.com is asked only for the release download.
  assert.deepEqual(requests.map(({ url }) => url), [DEGAUSS, `${PROXY}${DEGAUSS}`, 'https://example.com/db.json']);

  // An error status from gh-proxy.com says the same.
  globalThis.fetch = recordingFetch([], (url) => (url.startsWith(PROXY) ? new Response('Bad gateway', { status: 502 }) : failToFetch()));
  await assert.rejects(loadDatabaseSourceUrl(TAGGED), { message: releaseError(TAGGED, 'db.json') });
});

test('a release download the browser cannot read is read through gh-proxy.com, and keeps its own URL', async () => {
  const database = {
    db_id: 'released_db',
    v: 1,
    timestamp: 1710000000,
    files: {},
    folders: {},
    archives: {
      roms: {
        description: 'ROMs',
        format: 'zip',
        extract: 'all',
        target_folder: 'games/roms/',
        archive_file: { url: 'https://example.com/roms.zip', size: 1, hash: 'h' },
        summary_file: { url: 'summary.json', size: 1, hash: 'h' },
      },
    },
  };
  const summary = { files: { 'games/roms/a.bin': { arc_id: 'roms', arc_at: 'a.bin', size: 1 } }, folders: {} };
  const SUMMARY = 'https://github.com/owner/repo/releases/download/v1.0.0/summary.json';
  const requests = [];
  globalThis.fetch = recordingFetch(requests, (url) => {
    if (!url.startsWith(PROXY)) failToFetch();
    // As a browser's would, the response says it came from gh-proxy.com.
    const response = new Response(JSON.stringify(url.endsWith('/summary.json') ? summary : database));
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });

  const loaded = await loadDatabaseSourceUrl(TAGGED, { reload: true });
  assert.equal(loaded.inspection.overview.dbId, 'released_db');
  assert.equal(loaded.inspection.source.sourceLabel, TAGGED);
  assert.equal(loaded.inspection.source.sourceUrl, TAGGED);
  assert.equal(loaded.inspection.source.readThrough, 'gh-proxy.com');
  // A summary file the database names relatively is in the same release, and goes the same way.
  assert.equal(loaded.inspection.archiveViews[0].summaryRecords.length, 1);
  assert.deepEqual(requests.map(({ url }) => url), [TAGGED, `${PROXY}${TAGGED}`, SUMMARY, `${PROXY}${SUMMARY}`]);
  // A reload asks gh-proxy.com again too.
  assert.equal(requests[1].init.cache, 'no-cache');
});

test('gh-proxy.com is asked only for release downloads, and only when reading them directly fails', async () => {
  const body = JSON.stringify({ db_id: 'direct_db', v: 1, timestamp: 1710000000, files: {}, folders: {} });
  let requests = [];
  globalThis.fetch = recordingFetch(requests, () => new Response(body));
  const loaded = await loadDatabaseSourceUrl(TAGGED);
  assert.equal(loaded.inspection.source.readThrough, null);
  assert.deepEqual(requests.map(({ url }) => url), [TAGGED]);

  for (const url of [
    'https://github.com/owner/repo/raw/main/db.json',
    'http://github.com/owner/repo/releases/download/v1.0.0/db.json',
    'https://example.com/github.com/owner/repo/releases/download/v1.0.0/db.json',
    'https://github.com.example.com/owner/repo/releases/download/v1.0.0/db.json',
  ]) {
    requests = [];
    globalThis.fetch = recordingFetch(requests, failToFetch);
    await assert.rejects(loadDatabaseSourceUrl(url));
    assert.deepEqual(requests.map((request) => request.url), [url], url);
  }
});

test('the release downloads a message names are found once each', () => {
  const message =
    `GitHub does not let websites read release downloads, so ${DEGAUSS} cannot be opened in the browser. ` +
    `Could not open ${DEGAUSS}. Another one failed: ${TAGGED}, and so did https://example.com/db.json.`;

  assert.deepEqual(findGitHubReleaseDownloads(message), [
    { url: DEGAUSS, fileName: 'degauss.json.zip' },
    { url: TAGGED, fileName: 'db.json' },
  ]);
  assert.deepEqual(findGitHubReleaseDownloads('Could not open https://example.com/db.json in the browser.'), []);
  assert.deepEqual(findGitHubReleaseDownloads(''), []);
});

test('a reload asks the website again instead of reusing the cached copy', async () => {
  const requests = [];
  const body = JSON.stringify({ db_id: 'cached_db', v: 1, timestamp: 1710000000, files: {}, folders: {} });
  globalThis.fetch = recordingFetch(requests, () => new Response(body, { headers: { 'content-type': 'application/json' } }));

  await loadDatabaseSourceUrl('https://example.com/db.json');
  await loadDatabaseSourceUrl('https://example.com/db.json', { reload: true });

  assert.deepEqual(
    requests.map(({ init }) => init),
    [{ redirect: 'follow' }, { redirect: 'follow', cache: 'no-cache' }],
  );
});
