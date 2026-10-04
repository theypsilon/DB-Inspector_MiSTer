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

test('a release download the browser cannot read says why, and how to inspect it anyway', async () => {
  const requests = [];
  globalThis.fetch = recordingFetch(requests, () => {
    throw new TypeError('Failed to fetch');
  });

  await assert.rejects(loadDatabaseSourceUrl(DEGAUSS), {
    message: `GitHub does not let websites read release downloads, so ${DEGAUSS} cannot be opened in the browser. Download degauss.json.zip and drag it into Upload to inspect it.`,
  });
  await assert.rejects(loadDatabaseSourceUrl('https://example.com/db.json'), {
    message: 'Could not open https://example.com/db.json in the browser. The website may block direct access or be temporarily unavailable.',
  });
  assert.deepEqual(requests.map(({ url }) => url), [DEGAUSS, 'https://example.com/db.json']);
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
