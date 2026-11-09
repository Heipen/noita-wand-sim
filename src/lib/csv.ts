/** Minimal CSV parser (RFC 4180 style with quoted fields) for Noita's common.csv. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface Translations {
  get(key: string, lang: 'en' | 'zh'): string | undefined;
  readonly size: number;
}

const EMPTY: Translations = { get: () => undefined, size: 0 };

/**
 * Build a translation lookup from Noita's `data/translations/common.csv`.
 * Header columns are language codes (`en`, `zh-cn`, `jp`, ...); the first column is the key.
 */
export function buildTranslations(csvText: string | null | undefined): Translations {
  if (!csvText) return EMPTY;
  const rows = parseCsv(csvText);
  if (rows.length < 2) return EMPTY;
  const header = rows[0].map((h) => h.trim());
  const enIndex = header.indexOf('en');
  const zhIndex = header.indexOf('zh-cn');
  if (enIndex < 0 && zhIndex < 0) return EMPTY;

  const map = new Map<string, { en?: string; zh?: string }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const key = row[0];
    if (!key) continue;
    map.set(key, { en: row[enIndex], zh: row[zhIndex] });
  }
  return {
    size: map.size,
    get(key, lang) {
      const value = map.get(key);
      if (!value) return undefined;
      const v = lang === 'zh' ? value.zh : value.en;
      return v && v.length > 0 ? v : undefined;
    },
  };
}
