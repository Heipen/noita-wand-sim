import { useRef } from 'react';
import type { ImportStage } from '../lib/gameData';
import { t } from '../lib/i18n';
import type { Lang } from '../lib/types';

interface Props {
  lang: Lang;
  supportsDirectory: boolean;
  stage?: ImportStage;
  error?: string | null;
  onPickDirectory: () => void;
  onPickFiles: (files: File[]) => void;
}

const STAGE_KEY: Record<ImportStage, string> = {
  reading: 'import.stage.reading',
  parsing: 'import.stage.parsing',
  translations: 'import.stage.translations',
  catalog: 'import.stage.catalog',
  saving: 'import.stage.saving',
};

export function ImportPanel({ lang, supportsDirectory, stage, error, onPickDirectory, onPickFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loading = stage !== undefined;

  return (
    <section className="import-panel">
      <h2>{t(lang, 'import.title')}</h2>
      <p className="import-desc">{t(lang, 'import.desc')}</p>

      {!supportsDirectory && <p className="notice">{t(lang, 'import.unsupported')}</p>}

      <div
        className={`drop-zone${loading ? ' busy' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) onPickFiles(files);
        }}
      >
        {loading ? (
          <div className="stage">{t(lang, STAGE_KEY[stage])}</div>
        ) : (
          <>
            <div className="drop-hint">{t(lang, 'import.dropHint')}</div>
            <div className="actions">
              {supportsDirectory && (
                <button className="primary" onClick={onPickDirectory}>
                  {t(lang, 'import.chooseFolder')}
                </button>
              )}
              <button className={supportsDirectory ? 'secondary' : 'primary'} onClick={() => inputRef.current?.click()}>
                {t(lang, 'import.chooseFiles')}
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="error">
          <strong>{t(lang, 'import.error')}</strong>
          <span>{error}</span>
        </div>
      )}

      <p className="privacy">{t(lang, 'import.privacy')}</p>

      <input
        ref={inputRef}
        type="file"
        accept=".wak,.csv"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onPickFiles(files);
          event.target.value = '';
        }}
      />
    </section>
  );
}
