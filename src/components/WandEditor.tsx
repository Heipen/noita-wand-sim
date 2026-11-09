import { useMemo } from 'react';
import { PRESETS } from '../data/presets';
import { formatFramesAsSeconds } from '../lib/format';
import { spellIconUrl } from '../lib/icons';
import { t } from '../lib/i18n';
import type { GameData, Lang, SpellMeta } from '../lib/types';
import {
  createEmptyWand,
  filledSlots,
  placeSpell,
  setAlwaysCast,
  swapSlots,
  wandSlots,
  normalizeWand,
  MAX_ALWAYS_CAST,
  type WandState,
} from '../lib/wand';
import type { HoverHandlers } from './SpellCard';

interface Props {
  data: GameData;
  lang: Lang;
  wand: WandState;
  hover: HoverHandlers;
  onChange: (wand: WandState) => void;
  onShare: () => void;
  copied: boolean;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function WandEditor({ data, lang, wand, hover, onChange, onShare, copied }: Props) {
  const spellById = useMemo(() => new Map(data.spells.map((spell) => [spell.id, spell])), [data.spells]);
  const slots = wandSlots(wand);
  const used = filledSlots(wand);

  const update = (patch: Partial<WandState>) => onChange(normalizeWand({ ...wand, ...patch }));

  const onDropToSlot = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    const spellId = event.dataTransfer.getData('application/x-spell');
    const fromSlot = event.dataTransfer.getData('application/x-slot');
    if (spellId) {
      onChange(placeSpell(wand, index, spellId));
    } else if (fromSlot !== '') {
      onChange(swapSlots(wand, Number(fromSlot), index));
    }
  };

  const onDropToAlways = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    const spellId = event.dataTransfer.getData('application/x-spell');
    if (spellId) onChange(setAlwaysCast(wand, index, spellId));
  };

  const slotContent = (id: string | null, index: number) => {
    if (!id) return <span className="slot-index">{index + 1}</span>;
    const spell = spellById.get(id);
    const icon = spell ? spellIconUrl(data, spell) : undefined;
    return (
      <>
        {icon ? <img src={icon} alt="" draggable={false} /> : <span className="slot-index">{id.slice(0, 2)}</span>}
        <button
          type="button"
          className="slot-remove"
          title={t(lang, 'editor.remove')}
          onClick={(event) => {
            event.stopPropagation();
            hover.hide();
            onChange(placeSpell(wand, index, null));
          }}
        >
          ×
        </button>
      </>
    );
  };

  return (
    <section className="panel wand-editor">
      <header className="panel-header">
        <h2>{t(lang, 'editor.title')}</h2>
        <span className="panel-sub">
          {t(lang, 'editor.slotsUsed', { n: used, capacity: wand.capacity })}
        </span>
      </header>

      <div className="wand-toolbar">
        <select
          className="preset-select"
          value=""
          onChange={(event) => {
            const preset = PRESETS.find((item) => item.id === event.target.value);
            if (preset) onChange(preset.wand);
          }}
        >
          <option value="">{t(lang, 'editor.presets')}…</option>
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {lang === 'zh' ? preset.nameZh : preset.nameEn}
            </option>
          ))}
        </select>
        <input
          className="wand-name"
          type="text"
          placeholder={t(lang, 'editor.name')}
          value={wand.name}
          onChange={(event) => update({ name: event.target.value })}
        />
        <button type="button" className="secondary small" onClick={() => onChange(createEmptyWand())}>
          {t(lang, 'editor.clear')}
        </button>
      </div>

      <div className="wand-slots">
        {slots.map((id, index) => (
          <div
            key={index}
            className={`wand-slot${id ? ' filled' : ''}`}
            data-slot={index}
            draggable={Boolean(id)}
            onDragStart={(event) => {
              if (!id) return;
              event.dataTransfer.setData('application/x-slot', String(index));
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropToSlot(index, event)}
            onPointerEnter={(event) => {
              if (id && spellById.get(id)) hover.show(event, spellById.get(id));
            }}
            onPointerLeave={hover.hide}
          >
            {slotContent(id, index)}
          </div>
        ))}
      </div>

      <div className="always-cast">
        <span className="field-label">{t(lang, 'editor.alwaysCast')}</span>
        <div className="always-slots">
          {Array.from({ length: MAX_ALWAYS_CAST }, (_, index) => {
            const id = wand.alwaysCast[index] ?? null;
            const spell: SpellMeta | undefined = id ? spellById.get(id) : undefined;
            const icon = spell ? spellIconUrl(data, spell) : undefined;
            return (
              <div
                key={index}
                className={`wand-slot always-slot${id ? ' filled' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDropToAlways(index, event)}
                onPointerEnter={(event) => {
                  if (spell) hover.show(event, spell);
                }}
                onPointerLeave={hover.hide}
              >
                {id ? (
                  <>
                    {icon ? <img src={icon} alt="" draggable={false} /> : <span className="slot-index">★</span>}
                    <button
                      type="button"
                      className="slot-remove"
                      onClick={() => onChange(setAlwaysCast(wand, index, null))}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className="slot-index">★</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="wand-stats">
        <NumberField
          label={t(lang, 'editor.spellsPerCast')}
          value={wand.actionsPerRound}
          min={1}
          max={26}
          step={1}
          onChange={(value) => update({ actionsPerRound: value })}
        />
        <NumberField
          label={t(lang, 'editor.capacity')}
          value={wand.capacity}
          min={1}
          max={26}
          step={1}
          onChange={(value) => update({ capacity: value })}
        />
        <NumberField
          label={t(lang, 'editor.castDelay')}
          value={Number((wand.castDelayFrames / 60).toFixed(2))}
          min={-5}
          max={5}
          step={0.01}
          suffix={t(lang, 'editor.seconds')}
          onChange={(value) => update({ castDelayFrames: Math.round(value * 60) })}
        />
        <NumberField
          label={t(lang, 'editor.recharge')}
          value={Number((wand.rechargeFrames / 60).toFixed(2))}
          min={0}
          max={10}
          step={0.01}
          suffix={t(lang, 'editor.seconds')}
          onChange={(value) => update({ rechargeFrames: Math.round(value * 60) })}
        />
        <NumberField
          label={t(lang, 'editor.manaMax')}
          value={wand.manaMax}
          min={1}
          max={100000}
          step={10}
          onChange={(value) => update({ manaMax: value })}
        />
        <NumberField
          label={t(lang, 'editor.manaCharge')}
          value={wand.manaChargeSpeed}
          min={0}
          max={100000}
          step={10}
          onChange={(value) => update({ manaChargeSpeed: value })}
        />
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={wand.shuffle}
            onChange={(event) => update({ shuffle: event.target.checked })}
          />
          <span className="field-label">{t(lang, 'editor.shuffle')}</span>
        </label>
      </div>

      <div className="wand-footer">
        <span className="muted">
          {t(lang, 'editor.castDelay')} {formatFramesAsSeconds(wand.castDelayFrames)}s ·{' '}
          {t(lang, 'editor.recharge')} {formatFramesAsSeconds(wand.rechargeFrames)}s
        </span>
        <button type="button" className="secondary small share-button" onClick={onShare}>
          {copied ? t(lang, 'share.copied') : t(lang, 'share.copy')}
        </button>
      </div>
    </section>
  );
}
