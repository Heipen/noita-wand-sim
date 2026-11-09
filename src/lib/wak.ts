import type { WakArchive, WakEntry } from './types';

/**
 * Noita `data/data.wak` reader.
 *
 * Layout (verified against the installed Jan 2025 build):
 *   header 16 B: u32 version; u32 fileCount; u32 dataStart; u32 reserved
 *   fileCount x: u32 offset (absolute in file); u32 size; u32 nameLen; char[nameLen] name
 * Entries are named with a `data/` prefix. Data blocks are raw (uncompressed).
 */
export function parseWak(buffer: ArrayBuffer): WakArchive {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) throw new Error('data.wak 太小，不是有效的 wak 文件');

  const view = new DataView(buffer, 0, bytes.length);
  const version = view.getUint32(0, true);
  const fileCount = view.getUint32(4, true);
  const dataStart = view.getUint32(8, true);

  const entries = new Map<string, WakEntry>();
  const decoder = new TextDecoder('utf-8');
  let pos = 16;
  for (let i = 0; i < fileCount; i++) {
    if (pos + 12 > bytes.length) throw new Error(`data.wak 索引在条目 ${i} 处被截断`);
    const offset = view.getUint32(pos, true);
    pos += 4;
    const size = view.getUint32(pos, true);
    pos += 4;
    const nameLen = view.getUint32(pos, true);
    pos += 4;
    if (pos + nameLen > bytes.length) throw new Error(`data.wak 文件名在条目 ${i} 处被截断`);
    const name = decoder.decode(bytes.subarray(pos, pos + nameLen));
    pos += nameLen;
    entries.set(name, { name, offset, size });
  }
  if (pos !== dataStart) {
    throw new Error(`data.wak 索引结束位置 ${pos} 与 dataStart ${dataStart} 不一致，可能不是 Noita 的 wak`);
  }
  return { version, fileCount, dataStart, entries, bytes };
}

/** Read one file from the archive. `name` may be given with or without the `data/` prefix. */
export function wakBytes(wak: WakArchive, name: string): Uint8Array | undefined {
  const candidates = name.startsWith('data/') ? [name, name.slice(5)] : [name, `data/${name}`];
  for (const candidate of candidates) {
    const entry = wak.entries.get(candidate);
    if (!entry) continue;
    const end = entry.offset + entry.size;
    if (end > wak.bytes.length) throw new Error(`data.wak 条目越界: ${candidate}`);
    return wak.bytes.subarray(entry.offset, end);
  }
  return undefined;
}

export function wakText(wak: WakArchive, name: string): string | undefined {
  const bytes = wakBytes(wak, name);
  return bytes ? new TextDecoder('utf-8').decode(bytes) : undefined;
}

export function wakHas(wak: WakArchive, name: string): boolean {
  return wakBytes(wak, name) !== undefined;
}
