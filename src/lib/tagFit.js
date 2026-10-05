// How many of a tree row's tags show on its line before "+N" counts the rest. Tags are written in a
// font whose characters all have the same width, so a tag's width is its padding plus its length
// times one character's width, and every row at the same depth has the same room for them. A tree
// list measures those widths once, from a hidden sample row (TagFitProbe), and each row it renders
// counts what fits from them, without measuring itself.

// How many tags a row shows before "+N" while the widths are unknown (before the list is measured,
// or where there is no layout, as in jsdom); a row with just one more shows them all.
export const TAGS_SHOWN = 4;

// Room left over on a row's line, so rounding never pushes its last tag onto a second line.
export const TAG_FIT_MARGIN_PX = 2;

// The sample text whose width gives one character's.
export const TAG_FIT_SAMPLE = '0000000000';

const NO_TAGS = Object.freeze([]);

// The tags a row shows (a file's, a folder's, or an archive entry's), in their order.
export function getRowTags(row) {
  const fields = row.type === 'archive' ? row.archive.primaryFields : row.node.primaryFields;
  return fields?.find((field) => field.kind === 'tags')?.value ?? NO_TAGS;
}

// The name a compact tag shows: its first.
export function compactTagName(tag) {
  return (tag.names ?? [tag.label])[0];
}

// The first `count` tags, and how many more there are.
export function compactTagList(tags, count = tags.length > TAGS_SHOWN + 1 ? TAGS_SHOWN : tags.length) {
  return count < tags.length
    ? { shown: tags.slice(0, count), hiddenCount: tags.length - count }
    : { shown: tags, hiddenCount: 0 };
}

// A text's width in characters of the tags' font. Characters outside printable ASCII may come from
// another font, and count as two, so a tag is never thought narrower than it is.
function textUnits(text) {
  let units = 0;
  for (const character of text ?? '') {
    const code = character.codePointAt(0);
    units += code >= 0x20 && code < 0x7f ? 1 : 2;
  }
  return units;
}

// How many of `tags` a row at `depth` shows: all of them when they fit on its line, else as many as
// fit, in order, with "+N" after them, and at least one. Without widths, the first four.
/** @param {TagFitMetrics | null} metrics */
export function fitTagCount(tags, metrics, depth) {
  if (!metrics) {
    return compactTagList(tags).shown.length;
  }

  const room = metrics.lineWidth - depth * metrics.indentStep - TAG_FIT_MARGIN_PX;
  const widths = tags.map((tag) => metrics.chipWidth + textUnits(compactTagName(tag)) * metrics.charWidth);
  const allWidth = widths.reduce((total, width, index) => total + (index ? metrics.gap : 0) + width, 0);
  if (allWidth <= room) {
    return tags.length;
  }

  let used = 0;
  let shown = 0;
  for (let index = 0; index < tags.length - 1; index += 1) {
    const next = used + (index ? metrics.gap : 0) + widths[index];
    const more = `+${tags.length - index - 1}`;
    if (next + metrics.gap + metrics.toggleWidth + more.length * metrics.toggleCharWidth > room) {
      break;
    }
    used = next;
    shown = index + 1;
  }
  return Math.max(shown, 1);
}

/**
 * The widths a row's tags are fitted with, in CSS pixels.
 * @typedef {object} TagFitMetrics
 * @property {number} lineWidth the line a row at depth 0 shows its tags on
 * @property {number} indentStep how much narrower the line is for each level of depth
 * @property {number} chipWidth a tag without text: its padding
 * @property {number} charWidth one character of a tag
 * @property {number} gap between two tags, and before "+N"
 * @property {number} toggleWidth "+N" without text
 * @property {number} toggleCharWidth one character of "+N", which is bold
 */

/**
 * The widths, from the boxes of the sample row's parts: its tag line, a box one indentation step
 * wide, and side by side an empty tag, a tag holding TAG_FIT_SAMPLE, an empty "+N" and one holding
 * TAG_FIT_SAMPLE. Null when nothing was laid out (a closed section, or jsdom).
 * @typedef {{ left: number, right: number, width: number }} Box
 * @param {{ line: Box, indent: Box, emptyChip: Box, sampleChip: Box, emptyToggle: Box, sampleToggle: Box }} boxes
 * @returns {TagFitMetrics | null}
 */
export function tagFitMetrics({ line, indent, emptyChip, sampleChip, emptyToggle, sampleToggle }) {
  const charWidth = (sampleChip.width - emptyChip.width) / TAG_FIT_SAMPLE.length;
  const toggleCharWidth = (sampleToggle.width - emptyToggle.width) / TAG_FIT_SAMPLE.length;
  if (!(line.width > 0 && charWidth > 0 && toggleCharWidth > 0)) {
    return null;
  }

  return {
    lineWidth: line.width,
    indentStep: indent.width,
    chipWidth: emptyChip.width,
    charWidth,
    gap: sampleChip.left - emptyChip.right,
    toggleWidth: emptyToggle.width,
    toggleCharWidth,
  };
}

// Whether two measurements are the same, so measuring again changes nothing.
/** @param {TagFitMetrics | null} a @param {TagFitMetrics | null} b */
export function sameTagFitMetrics(a, b) {
  if (!a || !b) {
    return a === b;
  }
  return Object.keys(a).every((key) => Math.abs(a[key] - b[key]) < 0.01);
}
