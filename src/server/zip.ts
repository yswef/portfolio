/**
 * Minimal ZIP reader.
 *
 * The control panel unpacks an uploaded archive in the browser (so the phone
 * does not have to upload a blob the server would have to expand) and then sends
 * the individual files. This implementation lives in the Worker as a fallback:
 * it parses the central directory of a stored/deflated archive and inflates each
 * entry with `DecompressionStream('deflate-raw')`, which both workerd and Node 22
 * provide natively.
 *
 * Deliberate limits: no ZIP64, no encryption, no multi-disk archives.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 500;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export interface ZipEntry {
  path: string;
  size: number;
  compressedSize: number;
  compression: number;
  crc32: number;
  /** Byte offset of the local file header. */
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  totalBytes: number;
}

function findEndOfCentralDirectory(view: DataView, length: number): number {
  const maxBack = Math.min(length, 65_557);
  for (let offset = length - 22; offset >= length - maxBack; offset -= 1) {
    if (offset < 0) break;
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

export function parseZip(buffer: ArrayBuffer): ZipArchive {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view, buffer.byteLength);
  if (eocd === -1) throw new Error('Not a ZIP archive');

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > MAX_ENTRIES) throw new Error('Archive has too many files');

  const entries: ZipEntry[] = [];
  let pointer = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (pointer + 46 > buffer.byteLength) break;
    if (view.getUint32(pointer, true) !== CENTRAL_SIGNATURE) break;

    const compression = view.getUint16(pointer + 10, true);
    const crc32 = view.getUint32(pointer + 16, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localHeaderOffset = view.getUint32(pointer + 42, true);
    const nameBytes = new Uint8Array(buffer, pointer + 46, nameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes).replace(/\\/g, '/');

    pointer += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith('/')) continue; // directory entry
    if (name.startsWith('__MACOSX/') || name.split('/').some((part) => part === '.DS_Store')) continue;
    if (compression !== 0 && compression !== 8) continue; // only stored + deflate

    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Archive is too large to unpack');
    entries.push({ path: sanitizeEntryPath(name), size, compressedSize, compression, crc32, localHeaderOffset });
  }

  return { entries, totalBytes };
}

/** Blocks absolute paths and `..` traversal. */
export function sanitizeEntryPath(path: string): string {
  const parts = path
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

export async function extractZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) throw new Error('Broken local header');
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.compression === 0) return compressed;
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unpacks every text-ish file of an archive — used as an upload fallback. */
export async function extractTextFiles(
  buffer: ArrayBuffer,
  options: { extensions?: string[]; maxFiles?: number } = {},
): Promise<{ path: string; text: string }[]> {
  const archive = parseZip(buffer);
  const allowed = options.extensions ?? ['.html', '.htm', '.css', '.js', '.json', '.txt', '.md', '.svg', '.xml'];
  const maxFiles = Math.min(options.maxFiles ?? 200, archive.entries.length);
  const out: { path: string; text: string }[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (const entry of archive.entries.slice(0, maxFiles)) {
    const lower = entry.path.toLowerCase();
    if (!allowed.some((extension) => lower.endsWith(extension))) continue;
    const bytes = await extractZipEntry(buffer, entry);
    out.push({ path: entry.path, text: decoder.decode(bytes) });
  }
  return out;
}
