// Fetch one public admissions page from the user's browser, without cookies or
// a proxy, and extract its readable text for a local model or report cache.
import { makeError } from './aiError';

export function normalizePublicPageUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw makeError('Enter the full public admissions-page URL, including https://.', { code: 'research_bad_url' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw makeError('The source must be a public HTTP or HTTPS page. Atlas does not fetch login-protected pages.', { code: 'research_bad_url' });
  }
  return url.href;
}

function readableText(html, contentType) {
  if (contentType.includes('text/plain')) return String(html).replace(/\s+/g, ' ').trim();
  if (typeof DOMParser === 'undefined') {
    throw makeError('This browser cannot parse the fetched page. Paste the public page text into Atlas instead.', { code: 'research_parser_unavailable' });
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, svg, iframe, form, nav, footer, header, aside, [aria-hidden="true"]').forEach((node) => node.remove());
  const main = Array.from(doc.querySelectorAll('main, article, [role="main"]'))
    .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
  const contentRoot = main || doc.body || doc.documentElement;
  const bodyText = /** @type {HTMLElement | null} */ (contentRoot)?.innerText
    || contentRoot?.textContent
    || '';
  return String(bodyText).replace(/[\t\u00a0 ]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

function looksLikeLoginPage(url, title, text) {
  const path = new URL(url).pathname;
  return /\/(login|log-in|signin|sign-in|authenticate|auth)(\/|$)/i.test(path)
    || (/\b(sign in|log in|login required)\b/i.test(title) && text.length < 12000);
}

export async function fetchPublicAdmissionsPage(sourceUrl) {
  const requestedUrl = normalizePublicPageUrl(sourceUrl);
  let response;
  try {
    response = await fetch(requestedUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      headers: { Accept: 'text/html, text/plain;q=0.9, */*;q=0.1' },
    });
  } catch (error) {
    throw makeError(
      `Could not fetch this public page from the browser. The site may block cross-origin requests or be unavailable. Atlas does not bypass the block or use a proxy; paste the page text below. Browser detail: ${error?.message || 'network or CORS error'}`,
      { code: 'research_fetch_failed', cause: error },
    );
  }

  const finalUrl = response.url || requestedUrl;
  if (!response.ok) {
    throw makeError(
      `The public page returned HTTP ${response.status}. Atlas does not retry through a proxy; paste the page text below.`,
      { code: 'research_fetch_failed', status: response.status },
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (/application\/(pdf|octet-stream)/i.test(contentType)) {
    throw makeError('This URL returned a PDF or binary file, which Atlas cannot extract in the browser. Paste the relevant public page text instead.', { code: 'research_unsupported_content' });
  }

  const html = await response.text();
  const text = readableText(html, contentType);
  const docTitle = contentType.includes('text/plain') ? '' : (() => {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : '';
  })();
  if (looksLikeLoginPage(finalUrl, docTitle, text)) {
    throw makeError('This URL led to a sign-in page. Atlas does not access pages behind a login; paste only text you can view publicly.', { code: 'research_login_required' });
  }
  if (!text) {
    throw makeError('No readable text was found on this page. Paste the official page text below.', { code: 'research_empty_page' });
  }

  return { sourceUrl: finalUrl, title: docTitle, text };
}
