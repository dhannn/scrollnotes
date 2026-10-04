/**
 * Minimal ZIP writer (Slice 6)
 * ----------------------------
 * STORE method (compression method 0) only.
 *
 * Why hand-rolled instead of jszip/fflate: AGENTS section 4 says not to add dependencies
 * merely because they are fashionable. The payloads here are JPEG/PNG (already
 * entropy-coded) plus a handful of small text files, so deflate would recover roughly
 * nothing while adding ~40 KB and an async API. createZip is a single pure function, which
 * also makes the format directly testable in Node.
 *
 * The output is a spec-conformant PKZIP archive: local file headers, a central directory,
 * and an end-of-central-directory record. unzip, Python zipfile, and Explorer all read it.
 */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum PKZIP uses. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS packed date/time. DOS timestamps start at 1980 and cannot represent anything
 * before it, so earlier dates clamp rather than producing a negative field.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value & 0xffff, true);
    this.push(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.push(b);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

const encoder = new TextEncoder();

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. "images/ugc-000001.png". */
  path: string;
  bytes: Uint8Array;
}
/**
 * Build a ZIP archive from the given entries, in the order supplied.
 *
 * modifiedAt is injected rather than read from the clock so the writer is deterministic
 * and therefore testable.
 */
export function createZip(entries: ZipEntry[], modifiedAt: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(modifiedAt);
  const out = new ByteWriter();
  const central: {
    pathBytes: Uint8Array;
    crc: number;
    size: number;
    localOffset: number;
  }[] = [];

  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const localOffset = out.length;

    // Local file header
    out.u32(0x04034b50); // signature
    out.u16(20); // version needed to extract (2.0)
    out.u16(0x0800); // general purpose flags: UTF-8 filenames
    out.u16(0); // compression method 0 = STORE
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(entry.bytes.length); // compressed size
    out.u32(entry.bytes.length); // uncompressed size
    out.u16(pathBytes.length);
    out.u16(0); // extra field length
    out.push(pathBytes);
    out.push(entry.bytes);

    central.push({ pathBytes, crc, size: entry.bytes.length, localOffset });
  }

  const centralStart = out.length;

  for (const record of central) {
    // Central directory file header
    out.u32(0x02014b50); // signature
    out.u16(20); // version made by
    out.u16(20); // version needed to extract
    out.u16(0x0800); // flags: UTF-8 filenames
    out.u16(0); // method: STORE
    out.u16(time);
    out.u16(date);
    out.u32(record.crc);
    out.u32(record.size);
    out.u32(record.size);
    out.u16(record.pathBytes.length);
    out.u16(0); // extra field length
    out.u16(0); // file comment length
    out.u16(0); // disk number start
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(record.localOffset);
    out.push(record.pathBytes);
  }

  const centralSize = out.length - centralStart;

  // End of central directory record
  out.u32(0x06054b50); // signature
  out.u16(0); // disk number
  out.u16(0); // disk with central directory
  out.u16(central.length); // entries on this disk
  out.u16(central.length); // total entries
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // archive comment length

  return out.concat();
}

/**
 * Decode a frame's data URL into raw bytes.
 *
 * Supports the two encodings that actually occur in this app: base64 (canvas output, file
 * imports) and percent-encoded text (SVG data URLs). Returns null for anything
 * unrecognised rather than throwing, so a single malformed frame degrades into a reported
 * export error instead of losing the whole bundle (AGENTS section 39).
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return null;

  const header = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  try {
    if (/;base64/i.test(header)) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    // Percent-encoded UTF-8 text (typical for SVG).
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

/** Best-effort file extension for an image, derived from its MIME type. */
export function extensionForMime(mimeType: string | undefined, fallback = 'png'): string {
  if (!mimeType) return fallback;
  const subtype = mimeType.split('/')[1]?.toLowerCase();
  if (!subtype) return fallback;
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'x-png') return 'png';
  return subtype.replace(/[^a-z0-9]/g, '') || fallback;
}

/** The single DOM-aware export helper. Everything else in this module is pure. */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/zip'
): void {
  // Copy into a fresh ArrayBuffer so the Blob owns memory the caller can release.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick; revoking synchronously can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}