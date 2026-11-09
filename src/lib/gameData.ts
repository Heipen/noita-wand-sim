import { buildSpellCatalog } from './catalog';
import { buildTranslations } from './csv';
import type { GameData } from './types';
import { parseWak, wakBytes } from './wak';

export interface RawGameImport {
  wakBuffer: ArrayBuffer;
  csvText: string | null;
  sourceName: string;
}

export type ImportStage = 'reading' | 'parsing' | 'translations' | 'catalog' | 'saving';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildGameData(
  raw: RawGameImport,
  onStage?: (stage: ImportStage) => void,
  importedAt?: number,
): Promise<GameData> {
  onStage?.('parsing');
  const wak = parseWak(raw.wakBuffer);

  onStage?.('translations');
  const translations = buildTranslations(raw.csvText);

  onStage?.('catalog');
  const spells = buildSpellCatalog(wak, translations);

  const gunActions = wakBytes(wak, 'data/scripts/gun/gun_actions.lua');
  if (!gunActions) throw new Error('data.wak 中找不到 gun_actions.lua');
  const signature = (await sha256Hex(gunActions)).slice(0, 12);

  return {
    wak,
    spells,
    signature,
    importedAt: importedAt ?? Date.now(),
    sourceName: raw.sourceName,
    hasTranslations: translations.size > 0,
    origin: 'local',
  };
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function findFile(dir: FileSystemDirectoryHandle, segments: string[]): Promise<File | null> {
  try {
    let current = dir;
    for (const segment of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(segment);
    }
    const handle = await current.getFileHandle(segments[segments.length - 1]);
    return await handle.getFile();
  } catch {
    return null;
  }
}

/** Pick the Noita install folder (or the `data` folder) via the File System Access API. */
export async function pickFromDirectory(onStage?: (stage: ImportStage) => void): Promise<RawGameImport> {
  if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持选择文件夹');
  const dir = await window.showDirectoryPicker({ mode: 'read' });

  onStage?.('reading');
  let wakFile = await findFile(dir, ['data', 'data.wak']);
  let csvFile = await findFile(dir, ['data', 'translations', 'common.csv']);
  if (!wakFile) {
    wakFile = await findFile(dir, ['data.wak']);
    csvFile = csvFile ?? (await findFile(dir, ['translations', 'common.csv']));
  }
  if (!wakFile) throw new Error('找不到 data/data.wak —— 请选择 Noita 安装目录或它的 data 目录');

  return {
    wakBuffer: await wakFile.arrayBuffer(),
    csvText: csvFile ? await csvFile.text() : null,
    sourceName: dir.name || 'data.wak',
  };
}

/** Fallback import for browsers without directory picking: user selects data.wak (and optional common.csv). */
export async function importFromFiles(files: File[]): Promise<RawGameImport> {
  const wakFile = files.find((file) => file.name.toLowerCase() === 'data.wak');
  if (!wakFile) throw new Error('请选择 data.wak 文件');
  const csvFile = files.find((file) => file.name.toLowerCase() === 'common.csv');
  return {
    wakBuffer: await wakFile.arrayBuffer(),
    csvText: csvFile ? await csvFile.text() : null,
    sourceName: wakFile.name,
  };
}
