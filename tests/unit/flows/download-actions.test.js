import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { file, openApp } from '../support/app.js';
import { getRowFileLinks } from '../../../src/lib/downloads.js';

// Mirrors tests/download-actions.spec.js.

let app;
afterEach(() => app?.close());

test('browser-native file types expose OPEN while binary files stay download-only', async () => {
  app = await openApp('/');
  await app.upload(file('download-actions.json', buildDownloadActionDatabase()));
  assert.equal(app.view.heading, 'download_actions');

  const links = (name) => {
    const row = [...app.view.filesystemIndex.rowsById.values()].find((candidate) => candidate.node.name === name);
    return getRowFileLinks(row);
  };

  for (const fileName of ['notes.txt', 'settings.ini', 'readme.md', 'manual.pdf']) {
    const { downloadUrl, openUrl, viewUrl } = links(fileName);
    assert.ok(downloadUrl, `${fileName} can be downloaded`);
    assert.equal(openUrl, downloadUrl, `${fileName} can be opened`);
    assert.equal(viewUrl, null, `${fileName} is not an image to view`);
  }

  // An image is viewed in a dialog over the page (VIEW) rather than opened in a new tab.
  const image = links('cover.png');
  assert.deepEqual(image, { downloadUrl: 'https://example.com/files/cover.png', openUrl: null, viewUrl: 'https://example.com/files/cover.png' });

  const binary = links('core.rbf');
  assert.equal(binary.downloadUrl, 'https://example.com/files/core.rbf');
  assert.equal(binary.openUrl, null);
  assert.equal(binary.viewUrl, null);
});

function buildDownloadActionDatabase() {
  return {
    db_id: 'download_actions',
    v: 1,
    timestamp: 1710000000,
    files: {
      'docs/notes.txt': {
        url: 'https://example.com/files/notes.txt',
      },
      'docs/settings.ini': {
        url: 'https://example.com/files/settings.ini',
      },
      'docs/readme.md': {
        url: 'https://example.com/files/readme.md',
      },
      'docs/manual.pdf': {
        url: 'https://example.com/files/manual.pdf',
      },
      'images/cover.png': {
        url: 'https://example.com/files/cover.png',
      },
      'cores/core.rbf': {
        url: 'https://example.com/files/core.rbf',
      },
    },
    folders: {},
    archives: {},
  };
}
