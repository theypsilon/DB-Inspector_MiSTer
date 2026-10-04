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

export function isBrowserOpenableFile(path) {
  const normalizedPath = String(path).trim().toLowerCase();
  const extension = normalizedPath.split('.').pop();
  if (!extension || extension === normalizedPath) {
    return false;
  }

  return (
    OPENABLE_TEXT_FILE_EXTENSIONS.has(extension) ||
    extension === 'pdf' ||
    OPENABLE_IMAGE_FILE_EXTENSIONS.has(extension)
  );
}

// The links a tree row offers: Download for a file with a URL, and OPEN as well when the browser
// can show that file itself.
export function getRowFileLinks(row) {
  const isFile = row.type !== 'archive' && row.node.kind === 'file';
  const downloadUrl = isFile ? row.node.downloadUrl : null;
  const openUrl = isFile && isBrowserOpenableFile(row.node.path) ? downloadUrl : null;
  return { downloadUrl, openUrl };
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
