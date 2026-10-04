import GitHubRepoLink from './ui/GitHubRepoLink.jsx';

// A part of the hero that folds away when it is compact: its height and opacity animate, and it
// cannot be reached while folded.
/** @param {{ folded: boolean, className?: string, children?: import('react').ReactNode }} props */
function Fold({ folded, className, children }) {
  return (
    <div className={className ? `hero-fold ${className}` : 'hero-fold'} inert={folded}>
      <div>{children}</div>
    </div>
  );
}

/**
 * The top of the page: an introduction, with the project's repository and a note about MiSTer
 * Downloader. Once a database is loaded or being loaded (`compact`), it is just its title.
 * @param {{ compact: boolean }} props
 */
export default function Hero({ compact }) {
  return (
    <section className={compact ? 'hero panel hero-compact' : 'hero panel'}>
      <div>
        <Fold folded={compact}>
          <div className="hero-meta">
            <p className="eyebrow">Downloader Databases</p>
            <GitHubRepoLink repo="theypsilon/DB-Inspector_MiSTer" />
          </div>
        </Fold>
        <h1>Custom Database Inspector</h1>
        <Fold folded={compact}>
          <p className="hero-copy">
            Open a Downloader database from your computer or from a web link. Review its details,
            browse folders and files, filter its content, inspect archives, and spot warnings in
            one place.
          </p>
        </Fold>
      </div>
      <Fold folded={compact} className="hero-aside">
        <div className="hero-note">
          <strong>About MiSTer Downloader</strong>
          <p>
            MiSTer Downloader is the updater used on{' '}
            <a href="https://github.com/MiSTer-devel/Main_MiSTer/wiki" target="_blank" rel="noreferrer">
              MiSTer FPGA
            </a>{' '}
            to install and refresh cores, content, and support files from database definitions.
            This inspector helps you review those custom database files in the browser before using
            them.
          </p>
          <a
            href="https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/custom-databases.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the custom database spec
          </a>
        </div>
      </Fold>
    </section>
  );
}
