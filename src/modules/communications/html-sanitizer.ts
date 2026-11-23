import clean from 'sanitize-html';
export function sanitizeHtml(html: string): string {
  return clean(html, {
    allowedTags: ['strong', 'em', 'p', 'ul', 'ol', 'li', 'a', 'br'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (
        _tag,
        attrs,
      ): { tagName: string; attribs: Record<string, string> } => {
        try {
          const url = new URL(attrs.href);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
          return { tagName: 'a', attribs: { href: url.href } };
        } catch {
          return { tagName: 'a', attribs: {} };
        }
      },
    },
  });
}
export function validateHtmlContent(html: string) {
  return { valid: !!sanitizeHtml(html).trim() };
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
