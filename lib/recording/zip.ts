/**
 * A ZIP writer for exporting a recording from the phone, with no library.
 *
 * Only "stored" entries: the video is already compressed and the sensor
 * chunks are already gzipped, so deflating them again would cost a phone's
 * battery for nothing. That also means the archive is just headers around
 * the original bytes — the Blobs are never read or copied to build it, which
 * is what lets a gigabyte of video leave a phone without filling its memory.
 *
 * The one thing a stored ZIP still needs from each file is its CRC-32, and
 * that is computed when the piece is captured, while its bytes are in hand
 * for the SHA-256 anyway (components/pilot/capture.ts).
 *
 * No ZIP64: one archive stays under 4 GiB, and splitForZip() makes several
 * when a recording is longer than that (about twelve hours at the default
 * bitrate).
 */

let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

/** CRC-32 (IEEE), as ZIP and gzip use it. Pass the previous value to continue one. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  const t = table();
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  size: number;
  crc32: number;
  /** The bytes, untouched: a Blob from IndexedDB or a Uint8Array. */
  data: Blob | Uint8Array;
  modified?: Date;
}

const LIMIT = 0xffffffff;

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const encoder = new TextEncoder();

/**
 * The parts of a ZIP file, in order: hand them to `new Blob(parts)`.
 * Throws if the archive would need ZIP64.
 */
export function zipParts(entries: ZipEntry[]): { parts: (Blob | Uint8Array)[]; size: number } {
  if (entries.length > 0xffff) throw new Error('too many entries for one archive');
  const parts: (Blob | Uint8Array)[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const { time, date } = dosTime(entry.modified ?? new Date(0));
    if (entry.size > LIMIT || offset > LIMIT) throw new Error('archive too large for ZIP without ZIP64');

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local file header
    l.setUint16(4, 20, true); // version needed
    l.setUint16(6, 0x0800, true); // names are UTF-8
    l.setUint16(8, 0, true); // stored
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, entry.crc32 >>> 0, true);
    l.setUint32(18, entry.size, true);
    l.setUint32(22, entry.size, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const c = new DataView(dir.buffer);
    c.setUint32(0, 0x02014b50, true); // central directory header
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, entry.crc32 >>> 0, true);
    c.setUint32(20, entry.size, true);
    c.setUint32(24, entry.size, true);
    c.setUint16(28, name.length, true);
    // extra, comment, disk, internal and external attributes: all zero
    c.setUint32(42, offset, true);
    dir.set(name, 46);

    parts.push(local, entry.data);
    central.push(dir);
    offset += local.length + entry.size;
  }

  const dirSize = central.reduce((n, d) => n + d.length, 0);
  if (offset + dirSize > LIMIT) throw new Error('archive too large for ZIP without ZIP64');
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central directory
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);

  parts.push(...central, end);
  return { parts, size: offset + dirSize + end.length };
}

/** Comfortably under the 4 GiB a ZIP without ZIP64 can address. */
export const MAX_ARCHIVE_BYTES = 3.5 * 1024 ** 3;

/**
 * Groups items into archives that each stay under the limit, keeping their
 * order: part 1 holds the start of the job, part 2 what follows.
 */
export function splitForZip<T extends { size: number }>(items: T[], maxBytes = MAX_ARCHIVE_BYTES): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && bytes + item.size > maxBytes) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.size + 128; // headers
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
