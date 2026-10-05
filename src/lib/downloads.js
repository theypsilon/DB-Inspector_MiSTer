export const OPENABLE_TEXT_FILE_EXTENSIONS = new Set(['txt', 'ini', 'md']);
export const OPENABLE_IMAGE_FILE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

// A path's extension, in lower case, or null without one.
function fileExtension(path) {
  const normalizedPath = String(path).trim().toLowerCase();
  const extension = normalizedPath.split('.').pop();
  return !extension || extension === normalizedPath ? null : extension;
}

export function isBrowserOpenableFile(path) {
  const extension = fileExtension(path);
  if (!extension) {
    return false;
  }

  return (
    OPENABLE_TEXT_FILE_EXTENSIONS.has(extension) ||
    extension === 'pdf' ||
    OPENABLE_IMAGE_FILE_EXTENSIONS.has(extension)
  );
}

// The image of a file record that the explorer's details and a tree row's VIEW show: its URL, when
// browsers show the file as an image.
export function getImagePreviewUrl({ path, downloadUrl }) {
  return downloadUrl && OPENABLE_IMAGE_FILE_EXTENSIONS.has(fileExtension(path)) ? downloadUrl : null;
}

// The links a tree row offers: Download for a file with a URL, and when the browser can show that
// file itself, VIEW for an image (shown in a dialog over the page, loaded only then) or else OPEN.
export function getRowFileLinks(row) {
  const isFile = row.type !== 'archive' && row.node.kind === 'file';
  if (!isFile) {
    return { downloadUrl: null, openUrl: null, viewUrl: null };
  }

  const { downloadUrl, openUrl } = getFileLinks(row.node);
  const viewUrl = getImagePreviewUrl(row.node);
  return { downloadUrl, openUrl: viewUrl ? null : openUrl, viewUrl };
}

// The same links for a file record, as the explorer shows it.
export function getFileLinks({ path, downloadUrl }) {
  return {
    downloadUrl: downloadUrl ?? null,
    openUrl: downloadUrl && isBrowserOpenableFile(path) ? downloadUrl : null,
  };
}

export function resolveDownloadFileName(fileName, url) {
  const normalizedName = String(fileName || '').trim();
  if (normalizedName) {
    return normalizedName;
  }

  try {
    const parsedUrl = new URL(String(url).trim());
    const leaf = parsedUrl.pathname.split('/').pop();
    return leaf || 'download';
  } catch {
    return 'download';
  }
}

export function triggerBrowserDownload(href, fileName) {
  if (typeof document === 'undefined') {
    return;
  }

  const link = document.createElement('a');
  link.href = href;
  link.download = resolveDownloadFileName(fileName, href);
  link.rel = 'noreferrer';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}

export async function triggerFileDownload(url, fileName) {
  if (!url || typeof window === 'undefined') {
    return;
  }

  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch {
    throw { reason: 'network', url, fileName };
  }

  if (!response.ok) {
    throw { reason: 'http', status: response.status, url, fileName };
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw { reason: 'html', url, fileName };
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  triggerBrowserDownload(objectUrl, fileName);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}
