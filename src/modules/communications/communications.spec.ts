import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { sanitizeHtml } from './html-sanitizer.js';
import {
  validateFilename,
  validateFileSignature,
  validateOfficeDocument,
} from './attachment-validator.js';
import {
  CommunicationsGateway,
  DeliveryError,
} from './communications.gateway.js';
import { eligible, validateCategories } from './communications.policy.js';
const docx =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export function office(extra: Record<string, Uint8Array> = {}) {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      ),
      ...extra,
    }),
  );
}
describe('communications security and eligibility', () => {
  it.each([
    '<p onclick="x()">x</p>',
    '<div><script>alert(1)</script><p><img src=x onerror=x()>ok</p></div>',
    '<a href="jav&#97;script:alert(1)">x</a>',
    '<a href="//evil.test">x</a>',
    '<svg><a onload=x()>x</a></svg>',
  ])('sanitizes nested XSS: %s', (html) => {
    const out = sanitizeHtml(html);
    expect(out).not.toMatch(
      /script|onclick|onerror|onload|<img|<svg|href="\/\//i,
    );
  });
  it('preserves supported rich text and absolute safe links', () =>
    expect(
      sanitizeHtml(
        '<p><strong>ok</strong> <a href="https://example.com">link</a></p>',
      ),
    ).toContain('href="https://example.com/"'));
  it.each([
    '../a.txt',
    'a\\b.txt',
    'CON.txt',
    'x\u0000.txt',
    'x.exe',
    'bad.txt.',
  ])('rejects unsafe names %s', (n) =>
    expect(validateFilename(n, 'text/plain')).toBe(false),
  );
  it('matches extensions and strict utf8', () => {
    expect(validateFilename('é.txt', 'text/plain')).toBe(true);
    expect(validateFilename('x.png', 'application/pdf')).toBe(false);
    expect(validateFileSignature(Buffer.from([0xc3, 0x28]), 'text/plain')).toBe(
      false,
    );
    expect(validateFileSignature(Buffer.from('abc\u0000'), 'text/csv')).toBe(
      false,
    );
  });
  it('parses real office packages and rejects fake, macro, OLE, zip bomb and corrupt archives', () => {
    expect(validateOfficeDocument(office(), docx)).toBe(true);
    expect(
      validateOfficeDocument(
        Buffer.from('PK word/document.xml [Content_Types].xml'),
        docx,
      ),
    ).toBe(false);
    for (const [name, data] of [
      ['word/VBAPROJECT.BIN', strToU8('x')],
      ['word/embeddings/a.xml', strToU8('<x/>')],
      ['word/evil.xml', new Uint8Array(21 * 1024 * 1024)],
    ] as const)
      expect(validateOfficeDocument(office({ [name]: data }), docx)).toBe(
        false,
      );
    const broken = office();
    broken[40] ^= 1;
    expect(validateOfficeDocument(broken, docx)).toBe(false);
    expect(
      validateOfficeDocument(
        office(),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false);
  });
  it('includes payment_review despite timeout and cancellation request, composes confirmedOnly with category', () => {
    const c = {
      eventId: 'e',
      audienceType: 'categories',
      audienceCategoryIds: ['student'],
      confirmedOnly: false,
    };
    const r = {
      eventId: 'e',
      status: 'payment_review',
      suspendedAt: null,
      reservationExpiresAt: new Date(0),
      registrationTypeId: 'student',
      cancellationRequestedAt: new Date(),
    };
    expect(eligible(r, c)).toBe(true);
    expect(eligible(r, { ...c, confirmedOnly: true })).toBe(false);
    expect(
      eligible({ ...r, status: 'confirmed' }, { ...c, confirmedOnly: true }),
    ).toBe(true);
    expect(eligible({ ...r, status: 'reserved' }, c)).toBe(false);
    expect(eligible({ ...r, suspendedAt: new Date() }, c)).toBe(false);
    expect(eligible({ ...r, registrationTypeId: 'other' }, c)).toBe(false);
    expect(() =>
      validateCategories(
        { registrationTypes: [{ id: 'student' }] },
        'categories',
        ['alien'],
      ),
    ).toThrow();
  });
});
describe('dedicated Resend gateway', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'fake-unit-key');
    vi.stubEnv('EMAIL_FROM', 'verified@example.com');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const message = {
    from: 'verified@example.com',
    to: ['a@example.com'],
    reply_to: 'owner@example.com',
    subject: 'x',
    html: '<p>x</p>',
    text: 'x',
    attachments: [
      {
        filename: 'logo.png',
        content: 'YQ==',
        content_type: 'image/png',
        content_id: 'logo',
      },
    ],
  };
  it('sends stable key and native Resend fields regardless SMTP', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' })));
    vi.stubGlobal('fetch', fetch);
    expect(await new CommunicationsGateway().send(message, 'stable-key')).toBe(
      'provider-1',
    );
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers['Idempotency-Key']).toBe('stable-key');
    expect(JSON.parse(options.body)).toEqual(message);
  });
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [422, false],
  ])('classifies HTTP %s', async (status, temp) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status })),
    );
    await expect(
      new CommunicationsGateway().send(message, 'k'),
    ).rejects.toMatchObject({ temporary: temp, code: `HTTP_${status}` });
  });
  it('treats network/invalid success as uncertain temporary failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(
      new CommunicationsGateway().send(message, 'k'),
    ).rejects.toBeInstanceOf(DeliveryError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(
      new CommunicationsGateway().send(message, 'k'),
    ).rejects.toMatchObject({ temporary: true });
  });
  it('does not call network without configuration', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      new CommunicationsGateway().send(message, 'k'),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
