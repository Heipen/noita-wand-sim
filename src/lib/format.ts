export function framesToSeconds(frames: number): number {
  return frames / 60;
}

/** Format a frame count as the seconds value shown by the game ("-0.13", "0.17", "0"). */
export function formatFramesAsSeconds(frames: number, opts: { signed?: boolean } = {}): string {
  const seconds = frames / 60;
  if (Math.abs(seconds) < 0.005) return '0';
  const text = seconds.toFixed(2);
  return opts.signed && seconds > 0 ? `+${text}` : text;
}

/** Parse a `d`/`r` URL parameter: integers are frames, decimals are seconds. */
export function parseUrlFrames(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? value : Math.round(value * 60);
}

export function formatNumber(value: number, digits = 2): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}
