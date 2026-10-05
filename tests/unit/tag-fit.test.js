import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDatabaseSourceFile } from '../../src/lib/database.js';
import { buildFlatArchiveIndex, buildFlatNodeIndex } from '../../src/lib/treeIndex.js';
import {
  TAGS_SHOWN,
  TAG_FIT_MARGIN_PX,
  TAG_FIT_SAMPLE,
  compactTagList,
  compactTagName,
  fitTagCount,
  getRowTags,
  sameTagFitMetrics,
  tagFitMetrics,
} from '../../src/lib/tagFit.js';

const tags = (count) => Array.from({ length: count }, (_, index) => ({ id: `tag:${index}` }));
const named = (...names) => names.map((name, index) => ({ id: `tag:${index}`, label: name }));

// A tag of four characters is 10 + 4 * 8 = 42px wide, with 5px between two; "+3" is 10 + 2 * 9 = 28px,
// "+10" 37px. The room on a line is its width, less the margin and 20px for each level of depth.
const METRICS = { lineWidth: 300, indentStep: 20, chipWidth: 10, charWidth: 8, gap: 5, toggleWidth: 10, toggleCharWidth: 9 };
const lineOf = (room) => ({ ...METRICS, lineWidth: room + TAG_FIT_MARGIN_PX });
const fourLetters = (count) => named(...Array.from({ length: count }, () => 'abcd'));

test('without widths, tree rows show their first four tags and count the rest, unless there is only one more', () => {
  assert.equal(TAGS_SHOWN, 4);
  for (const count of [0, 1, 4, 5]) {
    assert.deepEqual(compactTagList(tags(count)), { shown: tags(count), hiddenCount: 0 }, String(count));
    assert.equal(fitTagCount(tags(count), null, 0), count);
  }
  assert.deepEqual(compactTagList(tags(6)), { shown: tags(4), hiddenCount: 2 });
  assert.deepEqual(compactTagList(tags(11)), { shown: tags(4), hiddenCount: 7 });
  assert.equal(fitTagCount(tags(6), null, 3), 4);
  assert.equal(fitTagCount(tags(11), null, 0), 4);
});

test('a given number of tags shows that many and counts the rest, one more included', () => {
  assert.deepEqual(compactTagList(tags(11), 6), { shown: tags(6), hiddenCount: 5 });
  assert.deepEqual(compactTagList(tags(11), 10), { shown: tags(10), hiddenCount: 1 });
  assert.deepEqual(compactTagList(tags(5), 5), { shown: tags(5), hiddenCount: 0 });
  assert.deepEqual(compactTagList(tags(3), 7), { shown: tags(3), hiddenCount: 0 });
});

test('a row shows all its tags when they fit on its line, to the pixel', () => {
  // Five tags: 5 * 42 + 4 * 5 = 230px.
  assert.equal(fitTagCount(fourLetters(5), lineOf(230), 0), 5);
  // A fraction less, and the last gives way to "+1".
  assert.equal(fitTagCount(fourLetters(5), lineOf(229.9), 0), 4);
  assert.equal(fitTagCount([], lineOf(10), 0), 0);
});

test('otherwise as many as fit before "+N", whose digits count', () => {
  // Five tags and "+3": 230 + 5 + 28 = 263px; six and "+2" would take 310px.
  assert.equal(fitTagCount(fourLetters(8), METRICS, 0), 5);
  // Three tags and "+9": 136 + 5 + 28 = 169px.
  assert.equal(fitTagCount(fourLetters(12), lineOf(169), 0), 3);
  assert.equal(fitTagCount(fourLetters(12), lineOf(168), 0), 2);
  // Three tags and "+10", a digit more: 178px.
  assert.equal(fitTagCount(fourLetters(13), lineOf(178), 0), 3);
  assert.equal(fitTagCount(fourLetters(13), lineOf(177), 0), 2);
});

test('each level of depth narrows the line', () => {
  // 298px at depth 0, 278px at depth 1, 258px at depth 2: five tags and "+3" take 263px.
  assert.equal(fitTagCount(fourLetters(8), METRICS, 1), 5);
  assert.equal(fitTagCount(fourLetters(8), METRICS, 2), 4);
});

test('a row shows at least one tag, even one wider than its line', () => {
  assert.equal(fitTagCount(fourLetters(3), lineOf(40), 0), 1);
  assert.equal(fitTagCount(named('a'.repeat(50)), lineOf(100), 0), 1);
  assert.equal(fitTagCount(fourLetters(8), METRICS, 20), 1);
});

test('a tag is as wide as its first name, and characters beyond ASCII count as two', () => {
  // "abcd" and "äbcd": 42 + 5 + 50 = 97px.
  const accented = named('abcd', 'äbcd');
  assert.equal(fitTagCount(accented, lineOf(97), 0), 2);
  assert.equal(fitTagCount(accented, lineOf(96), 0), 1);
  // Its other names are in its tooltip.
  const aliased = [{ id: 'tag:0', label: 'ab / abcdefghijklmnopqrstuvwxyz', names: ['ab', 'abcdefghijklmnopqrstuvwxyz'] }, ...named('cd')];
  assert.equal(compactTagName(aliased[0]), 'ab');
  assert.equal(compactTagName(aliased[1]), 'cd');
  // 26 + 5 + 26 = 57px.
  assert.equal(fitTagCount(aliased, lineOf(57), 0), 2);
});

test('the widths come from the sample row’s boxes, and nothing without layout', () => {
  const box = (left, width) => ({ left, right: left + width, width });
  const sample = TAG_FIT_SAMPLE.length;
  const boxes = {
    line: box(60, 1250),
    indent: box(0, 24.8),
    emptyChip: box(0, 17.6),
    sampleChip: box(24.8, 17.6 + sample * 7.87),
    emptyToggle: box(0, 19.2),
    sampleToggle: box(0, 19.2 + sample * 8.1),
  };
  const metrics = tagFitMetrics(boxes);
  assert.equal(metrics.lineWidth, 1250);
  assert.equal(metrics.indentStep, 24.8);
  assert.equal(metrics.chipWidth, 17.6);
  assert.ok(Math.abs(metrics.charWidth - 7.87) < 1e-9);
  assert.ok(Math.abs(metrics.gap - 7.2) < 1e-9);
  assert.equal(metrics.toggleWidth, 19.2);
  assert.ok(Math.abs(metrics.toggleCharWidth - 8.1) < 1e-9);

  const none = box(0, 0);
  assert.equal(tagFitMetrics({ line: none, indent: none, emptyChip: none, sampleChip: none, emptyToggle: none, sampleToggle: none }), null);
  assert.equal(tagFitMetrics({ ...boxes, line: none }), null);
});

test('a measurement is the same as another within a hundredth of a pixel', () => {
  assert.equal(sameTagFitMetrics(METRICS, { ...METRICS, lineWidth: 300.004 }), true);
  assert.equal(sameTagFitMetrics(METRICS, { ...METRICS, lineWidth: 301 }), false);
  assert.equal(sameTagFitMetrics(METRICS, { ...METRICS, charWidth: 8.5 }), false);
  assert.equal(sameTagFitMetrics(null, METRICS), false);
  assert.equal(sameTagFitMetrics(null, null), true);
});

test('a row’s tags are those of its file, folder or archive entry; an archive’s row has none', async () => {
  const loadedSource = await loadDatabaseSourceFile(
    new File(
      [
        JSON.stringify({
          db_id: 'tag_fit',
          timestamp: 1,
          base_files_url: 'https://example.com/',
          tag_dictionary: { arcade: 0, console: 1 },
          files: { 'cores/a.rbf': { tags: [0, 1] }, 'cores/b.rbf': {} },
          folders: { 'cores/': { tags: [1] } },
          archives: {
            arc: {
              format: 'zip',
              extract: 'selective',
              target_folder: 'games/',
              archive_file: { url: 'https://example.com/arc.zip', size: 1, hash: 'a' },
              summary_inline: { files: { 'games/x.bin': { arc_id: 'arc', arc_at: 'x.bin', size: 1, hash: 'x', tags: [0] } }, folders: {} },
            },
          },
        }),
      ],
      'db.json',
      { type: 'application/json' },
    ),
  );
  const { inspection } = loadedSource;
  const files = buildFlatNodeIndex(inspection.filesystemTree.children);
  const archives = buildFlatArchiveIndex(inspection.archiveViews);
  const labels = (row) => getRowTags(row).map((tag) => tag.label);
  assert.deepEqual(labels(files.rowsById.get('database:file:cores/a.rbf')).sort(), ['arcade', 'console']);
  assert.deepEqual(labels(files.rowsById.get('database:file:cores/b.rbf')), []);
  assert.deepEqual(labels(files.rowsById.get('database:folder:cores/')), ['console']);
  assert.deepEqual(labels(archives.rowsById.get('archive:arc')), []);
  const entry = [...archives.rowsById.values()].find((row) => row.type !== 'archive' && row.node.name === 'x.bin');
  assert.deepEqual(labels(entry), ['arcade']);
});
