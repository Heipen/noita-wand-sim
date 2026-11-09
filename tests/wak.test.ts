// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseWak, wakBytes, wakText } from '../src/lib/wak';

/** Build a minimal synthetic .wak: 16-byte header + entries + raw data. */
function buildWak(files: { name: string; content: string }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const names = files.map((f) => ({ name: f.name, bytes: encoder.encode(f.name), data: encoder.encode(f.content) }));
  const indexSize = names.reduce((sum, n) => sum + 12 + n.bytes.length, 0);
  const dataStart = 16 + indexSize;
  const dataSize = names.reduce((sum, n) => sum + n.data.length, 0);
  const buffer = new ArrayBuffer(dataStart + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, 0, true); // version
  view.setUint32(4, files.length, true); // fileCount
  view.setUint32(8, dataStart, true); // dataStart
  view.setUint32(12, 0, true); // reserved

  let indexPos = 16;
  let dataPos = dataStart;
  for (const entry of names) {
    view.setUint32(indexPos, dataPos, true);
    view.setUint32(indexPos + 4, entry.data.length, true);
    view.setUint32(indexPos + 8, entry.bytes.length, true);
    bytes.set(entry.bytes, indexPos + 12);
    bytes.set(entry.data, dataPos);
    indexPos += 12 + entry.bytes.length;
    dataPos += entry.data.length;
  }
  return buffer;
}

describe('parseWak', () => {
  it('parses header, entries and reads file contents', () => {
    const buffer = buildWak([
      { name: 'data/scripts/gun/gun_enums.lua', content: 'ACTION_TYPE_PROJECTILE = 0\n' },
      { name: 'data/ui_gfx/gun_actions/light_bullet.png', content: 'PNG' },
    ]);
    const wak = parseWak(buffer);

    expect(wak.version).toBe(0);
    expect(wak.fileCount).toBe(2);
    expect(wak.dataStart).toBeGreaterThan(16);
    expect([...wak.entries.keys()]).toEqual([
      'data/scripts/gun/gun_enums.lua',
      'data/ui_gfx/gun_actions/light_bullet.png',
    ]);

    expect(wakText(wak, 'data/scripts/gun/gun_enums.lua')).toBe('ACTION_TYPE_PROJECTILE = 0\n');
    // accepts paths without the data/ prefix too
    expect(wakText(wak, 'ui_gfx/gun_actions/light_bullet.png')).toBe('PNG');
    expect(wakBytes(wak, 'data/missing.txt')).toBeUndefined();
  });

  it('rejects a corrupted index (dataStart mismatch)', () => {
    const buffer = buildWak([{ name: 'data/a.txt', content: 'hello' }]);
    new DataView(buffer).setUint32(8, 12, true); // wrong dataStart
    expect(() => parseWak(buffer)).toThrow(/dataStart/);
  });
});
