import { findGitHubReleaseDownloads } from '../lib/database.js';

// What went wrong opening a source. The page cannot read the GitHub release downloads the message
// names, so each gets a link to download it, for the user to drag into Upload.
function ErrorPanel({ message }) {
  const downloads = findGitHubReleaseDownloads(message);
  return (
    <section className="panel status-panel">
      <p className="status error">{message}</p>
      {downloads.length ? (
        <div className="status-actions">
          {downloads.map(({ url, fileName }) => (
            <a key={url} className="inline-action-button" href={url} target="_blank" rel="noreferrer">
              Download {fileName}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default ErrorPanel;
