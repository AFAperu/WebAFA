/**
 * Helpers for text coming out of Airtable long-text (rich text) fields.
 */

/**
 * Airtable stores rich-text long-text fields as Markdown, so an underscore an
 * editor typed comes back from the API escaped as "\_". In prose that escape
 * is harmless: a Markdown renderer resolves it and the reader sees "_".
 * Inside a URL it is not, because a backslash is a legal URL character. The
 * renderer keeps it and percent-encodes it, so the link silently 404s:
 *
 *   Airtable field  …/forms/d/e/1FAIpQLSdRCE7rYRVx7FCP2U\_1ZtSO…/viewform
 *   marked href     …/forms/d/e/1FAIpQLSdRCE7rYRVx7FCP2U%5C_1ZtSO…/viewform
 *
 * The anchor text is rendered unescaped, so the link looks correct in the
 * email and only fails when clicked. Destinations that never render Markdown
 * at all — WhatsApp messages, Instagram captions, hrefs built from our JSON —
 * show the backslash verbatim and break the same way.
 *
 * Stripping the escapes inside URLs fixes every destination at once and
 * leaves prose alone, where the escapes are still doing their job.
 */
export function unescapeMarkdownUrls(text) {
  if (typeof text !== 'string' || !text.includes('\\')) return text;
  return text.replace(URL_PATTERN, (url) => url.replace(ESCAPED_PUNCTUATION, '$1'));
}

/** CommonMark's escapable ASCII punctuation. */
const ESCAPED_PUNCTUATION = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g;

/**
 * Deliberately greedy. A trailing full stop, or the closing paren of a
 * Markdown link, can get swallowed into the match — harmless, because the
 * only thing done to the match is removing backslash escapes.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
