import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyInspectionFilter,
  calculateClusteredFileBytes,
  summarizeInspectionStorage,
} from '../../src/lib/database.js';

test('clustered bytes round each file up to the selected cluster size', () => {
  assert.equal(calculateClusteredFileBytes([1, 128 * 1024, 128 * 1024 + 1], 128 * 1024), 4 * 128 * 1024);
});

test('zero-byte and invalid sizes do not consume cluster space', () => {
  assert.equal(calculateClusteredFileBytes([0, -1, Number.NaN], 128 * 1024), 0);
});

test('inspection storage summary includes raw bytes, clustered bytes, and unsized file count', () => {
  const summary = summarizeInspectionStorage(
    {
      filesystemRecords: [
        { kind: 'file', sizeBytes: 1 },
        { kind: 'file', sizeBytes: 10 },
        { kind: 'file', sizeBytes: null },
        { kind: 'folder' },
      ],
      archiveViews: [
        {
          summaryRecords: [
            { kind: 'file', sizeBytes: 5 },
            { kind: 'file', sizeBytes: null },
            { kind: 'folder' },
          ],
        },
      ],
    },
    8,
  );

  assert.deepEqual(summary, {
    rawBytes: 16,
    clusteredBytes: 32,
    sizedFileCount: 3,
    unsizedFileCount: 2,
  });
});

test('filtered storage summary only includes the surviving top-level and archive files', () => {
  const filteredInspection = applyInspectionFilter(
    {
      issues: [],
      overview: {},
      filesystemRecords: [
        createFileRecord('games/cheats/cheat.rbf', 100, ['cheats']),
        createFileRecord('games/consoles/console.rbf', 1000, ['console']),
        createFileRecord('games/plain/plain.rbf', 10, []),
      ],
      archiveViews: [
        {
          nodeId: 'archive:test',
          summaryRecords: [
            createFileRecord('games/archive/cheat.cht', 200, ['cheats']),
            createFileRecord('games/archive/console.cht', 2000, ['console']),
            createFileRecord('games/archive/plain.cht', 20, []),
          ],
        },
      ],
    },
    'cheats',
  );

  const summary = summarizeInspectionStorage(filteredInspection, 1);

  assert.deepEqual(summary, {
    rawBytes: 330,
    clusteredBytes: 330,
    sizedFileCount: 4,
    unsizedFileCount: 0,
  });
});

function createFileRecord(path, sizeBytes, filterTags) {
  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    badge: 'FILE',
    filterTags,
    sizeBytes,
    downloadUrl: null,
    primaryFields: [],
    details: [],
  };
}
