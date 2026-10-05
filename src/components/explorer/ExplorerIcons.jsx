// The explorer's icons, drawn in the color of the text around them unless their class says
// otherwise (folders and files take the tree's folder and file colors, in app.css).

/** @param {{ d: string }} props */
function Glyph({ d }) {
  return (
    <svg className="explorer-glyph" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const BackIcon = () => <Glyph d="M13 8H3M7.5 3.5 3 8l4.5 4.5" />;
export const ForwardIcon = () => <Glyph d="M3 8h10M8.5 3.5 13 8l-4.5 4.5" />;
export const UpIcon = () => <Glyph d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />;
export const CloseIcon = () => <Glyph d="M3.5 3.5l9 9M12.5 3.5l-9 9" />;
// The view the toggle switches to: icons, or the list.
export const IconsViewIcon = () => <Glyph d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" />;
export const ListViewIcon = () => <Glyph d="M2.5 4h11M2.5 8h11M2.5 12h11" />;
export const InfoIcon = () => <Glyph d="M8 7.2V11.5M8 4.6v.1M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" />;

/** @param {{ kind: 'folder' | 'file', large?: boolean }} props */
export function EntryIcon({ kind, large = false }) {
  const size = large ? 48 : 20;
  return kind === 'folder' ? (
    <svg className="explorer-entry-icon explorer-folder-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2 2.2h8.4a2 2 0 0 1 2 2v9.8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2Z" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="explorer-entry-icon explorer-file-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5.5 2.5h8.8l4.7 4.7v13.3a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M14.2 2.7v4.7h4.6M8 12h8M8 15.5h8" fill="none" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
