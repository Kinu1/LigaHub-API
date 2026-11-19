import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
/* oxlint-disable no-control-regex -- Uploaded names and text intentionally reject control bytes. */
import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
export const calculateChecksum = (b: Buffer) =>
  createHash('sha256').update(b).digest('hex');
const types: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    'pptx',
  ],
};
export function validateFilename(name: string, mime?: string) {
  if (
    !name ||
    name.length > 180 ||
    Buffer.byteLength(name) > 240 ||
    name !== name.normalize('NFC') ||
    /[\x00-\x1f\x7f-\x9f/\\:"<>|?*]/.test(name) ||
    name.startsWith('.') ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)
  )
    return false;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return !mime || !!types[mime]?.includes(ext);
}
function utf8(b: Buffer) {
  return new TextDecoder('utf-8', { fatal: true }).decode(b);
}
function crc32(b: Buffer) {
  let crc = 0xffffffff;
  for (const v of b) {
    crc ^= v;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function xml(b: Buffer) {
  const elements: {
    name: string;
    namespace: string;
    getAttribute: (name: string) => string | null;
  }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (e) => {
    throw e;
  });
  parser.on('doctype', () => {
    throw new Error('DTD not allowed');
  });
  parser.on('opentag', (tag) => {
    elements.push({
      name: tag.local,
      namespace: tag.uri,
      getAttribute: (name) => {
        const a = tag.attributes[name];
        return typeof a === 'string' ? a : (a?.value ?? null);
      },
    });
  });
  parser.write(utf8(b)).close();
  return {
    getElementsByTagName: (name: string) =>
      elements.filter((e) => e.name === name),
  };
}
// Parse central AND local records; inflate each bounded entry and verify CRC.
export function validateOfficeDocument(b: Buffer, mime: string): boolean {
  try {
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
      if (b.readUInt32LE(i) === 0x06054b50) {
        e = i;
        break;
      }
    if (
      e < 0 ||
      e + 22 + b.readUInt16LE(e + 20) !== b.length ||
      b.readUInt16LE(e + 4) ||
      b.readUInt16LE(e + 6)
    )
      return false;
    const n = b.readUInt16LE(e + 10),
      start = b.readUInt32LE(e + 16),
      size = b.readUInt32LE(e + 12);
    if (n < 3 || n > 1000 || b.readUInt16LE(e + 8) !== n || start + size !== e)
      return false;
    let p = start,
      total = 0;
    const entries = new Map<string, Buffer>(),
      ranges: [number, number][] = [],
      targets: string[] = [];
    for (let i = 0; i < n; i++) {
      if (p + 46 > e || b.readUInt32LE(p) !== 0x02014b50) return false;
      const flags = b.readUInt16LE(p + 8),
        method = b.readUInt16LE(p + 10),
        crc = b.readUInt32LE(p + 16),
        compressed = b.readUInt32LE(p + 20),
        expanded = b.readUInt32LE(p + 24),
        len = b.readUInt16LE(p + 28),
        extra = b.readUInt16LE(p + 30),
        comment = b.readUInt16LE(p + 32),
        offset = b.readUInt32LE(p + 42);
      if (
        flags & ~0x808 ||
        ![0, 8].includes(method) ||
        p + 46 + len + extra + comment > e ||
        expanded > 20 * 1024 * 1024 ||
        (total += expanded) > 40 * 1024 * 1024 ||
        expanded > Math.max(1024 * 1024, compressed * 200)
      )
        return false;
      const name = utf8(b.subarray(p + 46, p + 46 + len));
      const lower = name.toLowerCase();
      if (
        !name ||
        name.includes('\\') ||
        name.startsWith('/') ||
        name.split('/').some((s) => s === '..' || s === '.') ||
        /[\x00-\x1f:]/.test(name) ||
        entries.has(lower) ||
        /macro|vbaproject|activex|embeddings|oleobject/.test(lower) ||
        /\.(bin|exe|dll|com|scr|js|vbs|bat|cmd|ps1|msi|jar|zip)$/i.test(name)
      )
        return false;
      if (
        offset + 30 > start ||
        b.readUInt32LE(offset) !== 0x04034b50 ||
        b.readUInt16LE(offset + 6) !== flags ||
        b.readUInt16LE(offset + 8) !== method
      )
        return false;
      const localLen = b.readUInt16LE(offset + 26),
        dataStart = offset + 30 + localLen + b.readUInt16LE(offset + 28),
        end = dataStart + compressed;
      if (
        utf8(b.subarray(offset + 30, offset + 30 + localLen)) !== name ||
        end > start ||
        ranges.some(([a, z]) => offset < z && end > a)
      )
        return false;
      ranges.push([offset, end]);
      if (
        !(flags & 8) &&
        (b.readUInt32LE(offset + 14) !== crc ||
          b.readUInt32LE(offset + 18) !== compressed ||
          b.readUInt32LE(offset + 22) !== expanded)
      )
        return false;
      const packed = b.subarray(dataStart, end);
      const data =
        method === 0
          ? packed
          : inflateRawSync(packed, {
              maxOutputLength: Math.max(
                1,
                Math.min(expanded, 20 * 1024 * 1024),
              ),
            });
      if (
        data.length !== expanded ||
        crc32(data) !== crc ||
        data.subarray(0, 2).toString() === 'MZ' ||
        data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
      )
        return false;
      if (!name.endsWith('/') && !/\.(xml|rels|png|jpe?g|gif)$/i.test(name))
        return false;
      if (/\.(xml|rels)$/i.test(name)) {
        const text = utf8(data);
        if (
          /<!DOCTYPE|<!ENTITY|macroenabled|vbaproject|oleobject|activex/i.test(
            text,
          )
        )
          return false;
        const doc = xml(data);
        if (/\.rels$/i.test(name))
          for (const r of doc.getElementsByTagName('Relationship')) {
            const target = decodeURIComponent(
              (r.getAttribute('Target') ?? '').split('#')[0],
            );
            if (
              r.getAttribute('TargetMode')?.toLowerCase() === 'external' ||
              !target ||
              /^[a-z]+:|\\/i.test(target)
            )
              return false;
            const base =
              name === '_rels/.rels'
                ? ''
                : name.slice(0, name.lastIndexOf('/_rels/'));
            const resolved = posix.normalize(
              target.startsWith('/')
                ? target.slice(1)
                : posix.join(base, target),
            );
            if (resolved === '..' || resolved.startsWith('../')) return false;
            targets.push(resolved.toLowerCase());
          }
      }
      entries.set(lower, data);
      p += 46 + len + extra + comment;
    }
    const expected = mime.includes('wordprocessingml')
      ? [
          'word/document.xml',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        ]
      : mime.includes('spreadsheetml')
        ? [
            'xl/workbook.xml',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
          ]
        : [
            'ppt/presentation.xml',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
          ];
    if (targets.some((t) => !entries.has(t))) return false;
    const main = entries.get(expected[0]);
    if (!main) return false;
    const root = xml(main);
    const rootName = mime.includes('wordprocessingml')
      ? 'document'
      : mime.includes('spreadsheetml')
        ? 'workbook'
        : 'presentation';
    const rootNs = mime.includes('wordprocessingml')
      ? 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      : mime.includes('spreadsheetml')
        ? 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        : 'http://schemas.openxmlformats.org/presentationml/2006/main';
    if (
      !root.getElementsByTagName(rootName).some((r) => r.namespace === rootNs)
    )
      return false;
    if (
      p !== e ||
      !entries.has(expected[0]) ||
      !entries.has('[content_types].xml') ||
      !entries.has('_rels/.rels')
    )
      return false;
    const ct = xml(entries.get('[content_types].xml')!);
    if (
      !Array.from(ct.getElementsByTagName('Override')).some(
        (x) =>
          x.getAttribute('PartName') === `/${expected[0]}` &&
          x.getAttribute('ContentType') === expected[1],
      )
    )
      return false;
    const rel = xml(entries.get('_rels/.rels')!);
    return Array.from(rel.getElementsByTagName('Relationship')).some(
      (x) =>
        x.getAttribute('Type')?.endsWith('/officeDocument') &&
        x.getAttribute('Target')?.replace(/^\//, '') === expected[0],
    );
  } catch {
    return false;
  }
}
export function validateFileSignature(b: Buffer, mime: string): boolean {
  try {
    if (mime === 'application/pdf')
      return (
        b.subarray(0, 5).toString() === '%PDF-' &&
        b.subarray(-1024).toString('latin1').trimEnd().endsWith('%%EOF')
      );
    if (mime === 'image/png') return validPng(b);
    if (mime === 'image/jpeg') return validJpeg(b);
    if (mime === 'text/plain' || mime === 'text/csv')
      return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(utf8(b));
    return !!types[mime] && validateOfficeDocument(b, mime);
  } catch {
    return false;
  }
}

function validPng(b: Buffer) {
  if (
    b.length < 45 ||
    !b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    return false;
  let p = 8,
    header = false,
    data = false;
  while (p + 12 <= b.length) {
    const n = b.readUInt32BE(p),
      type = b.subarray(p + 4, p + 8).toString('ascii');
    if (
      n > b.length - p - 12 ||
      crc32(b.subarray(p + 4, p + 8 + n)) !== b.readUInt32BE(p + 8 + n)
    )
      return false;
    if (!header) {
      if (
        type !== 'IHDR' ||
        n !== 13 ||
        !b.readUInt32BE(p + 8) ||
        !b.readUInt32BE(p + 12)
      )
        return false;
      header = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') data = true;
    if (type === 'IEND') return n === 0 && data && p + 12 === b.length;
    p += 12 + n;
  }
  return false;
}
function validJpeg(b: Buffer) {
  if (b.length < 4 || b[0] !== 255 || b[1] !== 216) return false;
  let p = 2,
    frame = false,
    scan = false;
  while (p < b.length) {
    if (b[p++] !== 255) return false;
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 217) return frame && scan && p === b.length;
    if (marker === 216 || marker === 0 || p + 2 > b.length) return false;
    const n = b.readUInt16BE(p);
    if (n < 2 || p + n > b.length) return false;
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      if (n < 8 || !b.readUInt16BE(p + 3) || !b.readUInt16BE(p + 5))
        return false;
      frame = true;
    }
    p += n;
    if (marker === 218) {
      if (!frame) return false;
      scan = true;
      while (p < b.length) {
        if (b[p] !== 255) {
          p++;
          continue;
        }
        const next = b[p + 1];
        if (next === 0 || (next >= 208 && next <= 215)) {
          p += 2;
          continue;
        }
        break;
      }
    }
  }
  return false;
}
