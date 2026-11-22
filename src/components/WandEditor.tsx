import { useEffect, useMemo, useRef, useState } from 'react';
import { formatFramesAsSeconds } from '../lib/format';
import { spellIconUrl } from '../lib/icons';
import { t } from '../lib/i18n';
import type { GameData, Lang, SpellMeta } from '../lib/types';
import {
  clearSpells,
  createEmptyWand,
  filledSlots,
  normalizeWand,
  placeSpell,
  setAlwaysCast,
  shiftSpells,
  swapSlots,
  wandSlots,
  MAX_ALWAYS_CAST,
  MAX_CAPACITY,
  type WandState,
} from '../lib/wand';
import type { HoverHandlers } from './SpellCard';

export interface CustomPreset {
  id: string;
  name: string;
  wand: WandState;
}

export interface SpellTarget {
  kind: 'wand' | 'always';
  index: number;
}

interface Props {
  data: GameData;
  lang: Lang;
  wand: WandState;
  hover: HoverHandlers;
  customPresets: CustomPreset[];
  onChange: (wand: WandState) => void;
  onShare: () => void;
  onSavePreset: (name: string, wand: WandState) => void;
  onDeletePreset: (id: string) => void;
  copied: boolean;
  alwaysCastEnabled: boolean;
  onAlwaysCastToggle: (enabled: boolean) => void;
  wandStickyEnabled: boolean;
  onWandStickyToggle: (enabled: boolean) => void;
  zeroUsesEnabled: boolean;
  onZeroUsesToggle: (enabled: boolean) => void;
  isMobile: boolean;
  spellTarget?: SpellTarget | null;
  onSlotTarget?: (kind: SpellTarget['kind'], index: number) => void;
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
  const [draft, setDraft] = useState(() => String(value));
  const focused = useRef(false);

  useEffect(() => {
    // only sync from the wand while the user is not editing; otherwise an empty or
    // half-typed value would be overwritten immediately
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function WandEditor({
  data,
  lang,
  wand,
  hover,
  customPresets,
  onChange,
  onShare,
  onSavePreset,
  onDeletePreset,
  copied,
  alwaysCastEnabled,
  onAlwaysCastToggle,
  wandStickyEnabled,
  onWandStickyToggle,
  zeroUsesEnabled,
  onZeroUsesToggle,
  isMobile,
  spellTarget = null,
  onSlotTarget,
}: Props) {
  const spellById = useMemo(() => new Map(data.spells.map((spell) => [spell.id, spell])), [data.spells]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const slots = wandSlots(wand);
  const used = filledSlots(wand);
  const selectedCustom = customPresets.some((preset) => preset.id === selectedPreset);

  const update = (patch: Partial<WandState>) => onChange(normalizeWand({ ...wand, ...patch }));
  const dragSourceRef = useRef<{ kind: 'wand' | 'always'; index: number } | null>(null);
  const dropHandledRef = useRef(false);
  const dragClickGuardRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragSourceKey, setDragSourceKey] = useState<string | null>(null);
  const [dragOutside, setDragOutside] = useState(false);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const [slotsFit, setSlotsFit] = useState(false);

  useEffect(() => {
    const container = slotsRef.current;
    if (!container) return;
    const update = () => {
      const slotEls = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('wand-slot'),
      );
      if (slotEls.length === 0) {
        setSlotsFit(true);
        return;
      }
      const tops = slotEls.map((slot) => slot.getBoundingClientRect().top);
      const bottoms = slotEls.map((slot) => slot.getBoundingClientRect().bottom);
      const contentHeight = Math.max(...bottoms) - Math.min(...tops);
      const style = getComputedStyle(container);
      const available =
        container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setSlotsFit(contentHeight <= available + 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [slots.length, wand.capacity, isMobile]);

  useEffect(() => {
    const allowDrop = (event: DragEvent) => {
      if (!dragSourceRef.current) return;
      event.preventDefault();
      const slot = (event.target as Element | null)?.closest?.('.wand-slot');
      const key = slot?.getAttribute('data-slot-key') ?? null;
      const sourceKey = `${dragSourceRef.current.kind}:${dragSourceRef.current.index}`;
      const targetKey = key === sourceKey ? null : key;
      setDragOverKey((previous) => (previous === targetKey ? previous : targetKey));
      setDragOutside((previous) => (previous === !key ? previous : !key));
      setDragPointer({ x: event.clientX, y: event.clientY });
    };
    const dropOutside = (event: DragEvent) => {
      const source = dragSourceRef.current;
      if (!source || dropHandledRef.current) return;
      event.preventDefault();
      if (source.kind === 'wand') onChange(placeSpell(wand, source.index, null));
      else onChange(setAlwaysCast(wand, source.index, null));
      hover.hide();
      dragSourceRef.current = null;
      setDragActive(false);
      setDragOutside(false);
      setDragOverKey(null);
      setDragSourceKey(null);
      setDragPointer(null);
    };
    document.addEventListener('dragover', allowDrop);
    document.addEventListener('drop', dropOutside);
    return () => {
      document.removeEventListener('dragover', allowDrop);
      document.removeEventListener('drop', dropOutside);
    };
  }, [hover, onChange, wand]);

  const beginSlotDrag = (kind: 'wand' | 'always', index: number, event: React.DragEvent) => {
    event.dataTransfer.setData('application/x-slot', String(index));
    event.dataTransfer.setData('application/x-source', kind);
    event.dataTransfer.effectAllowed = 'move';
    const transparent = document.createElement('div');
    transparent.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(transparent);
    event.dataTransfer.setDragImage(transparent, 0, 0);
    setTimeout(() => transparent.remove(), 0);
    dragSourceRef.current = { kind, index };
    dropHandledRef.current = false;
    dragClickGuardRef.current = Date.now() + 300;
    setDragActive(true);
    setDragOutside(false);
    setDragOverKey(null);
    setDragSourceKey(`${kind}:${index}`);
    setDragPointer({ x: event.clientX, y: event.clientY });
  };

  const endSlotDrag = () => {
    dragSourceRef.current = null;
    dropHandledRef.current = false;
    dragClickGuardRef.current = Date.now() + 300;
    setDragActive(false);
    setDragOutside(false);
    setDragOverKey(null);
    setDragSourceKey(null);
    setDragPointer(null);
  };

  const deleteSlot = (kind: 'wand' | 'always', index: number, id: string | null) => {
    if (Date.now() < dragClickGuardRef.current) return;
    if (id) {
      hover.hide();
      onChange(kind === 'wand' ? placeSpell(wand, index, null) : setAlwaysCast(wand, index, null));
      return;
    }
    if (isMobile) onSlotTarget?.(kind, index);
  };

  const markHandledDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dropHandledRef.current = true;
    setDragActive(false);
    setDragOutside(false);
    setDragOverKey(null);
    setDragSourceKey(null);
    setDragPointer(null);
  };

  const onDropToSlot = (index: number, event: React.DragEvent) => {
    markHandledDrop(event);
    const spellId = event.dataTransfer.getData('application/x-spell');
    const fromSlot = event.dataTransfer.getData('application/x-slot');
    const source = event.dataTransfer.getData('application/x-source');
    if (spellId) {
      onChange(placeSpell(wand, index, spellId));
    } else if (source === 'always' && fromSlot !== '') {
      const from = Number(fromSlot);
      let next = placeSpell(wand, index, wand.alwaysCast[from] ?? null);
      next = setAlwaysCast(next, from, wand.spells[index] ?? null);
      onChange(next);
    } else if (fromSlot !== '') {
      onChange(swapSlots(wand, Number(fromSlot), index));
    }
  };

  const onDropToAlways = (index: number, event: React.DragEvent) => {
    markHandledDrop(event);
    const spellId = event.dataTransfer.getData('application/x-spell');
    const fromSlot = event.dataTransfer.getData('application/x-slot');
    const source = event.dataTransfer.getData('application/x-source');
    if (spellId) {
      onChange(setAlwaysCast(wand, index, spellId));
    } else if (source === 'always' && fromSlot !== '') {
      const from = Number(fromSlot);
      const target = wand.alwaysCast[index] ?? null;
      let next = setAlwaysCast(wand, index, wand.alwaysCast[from] ?? null);
      next = setAlwaysCast(next, from, target);
      onChange(next);
    } else if (source === 'wand' && fromSlot !== '') {
      const from = Number(fromSlot);
      let next = setAlwaysCast(wand, index, wand.spells[from] ?? null);
      next = placeSpell(next, from, wand.alwaysCast[index] ?? null);
      onChange(next);
    }
  };

  const slotContent = (id: string | null, index: number) => {
    if (!id) return <span className="slot-index">{index + 1}</span>;
    const spell = spellById.get(id);
    const icon = spell ? spellIconUrl(data, spell) : undefined;
    return (
      <>
        <span className="slot-number">{index + 1}</span>
        {icon ? <img src={icon} alt="" draggable={false} /> : <span className="slot-index">{id.slice(0, 2)}</span>}
      </>
    );
  };

  const presetName = () => wand.name.trim() || t(lang, 'editor.defaultPresetName');
  const dragSpellId = (() => {
    if (!dragSourceKey) return null;
    const [kind, rawIndex] = dragSourceKey.split(':');
    const index = Number(rawIndex);
    return kind === 'wand' ? (wand.spells[index] ?? null) : (wand.alwaysCast[index] ?? null);
  })();
  const dragSpell = dragSpellId ? spellById.get(dragSpellId) : undefined;
  const dragIcon = dragSpell ? spellIconUrl(data, dragSpell) : undefined;

  return (
    <>
      {dragActive && dragPointer && dragSpellId && (
        <div
          className={`slot-drag-proxy${dragOutside ? ' delete' : ''}`}
          style={{ left: dragPointer.x, top: dragPointer.y }}
        >
          {dragIcon ? <img src={dragIcon} alt="" /> : <span>{dragSpellId.slice(0, 2)}</span>}
        </div>
      )}
      <section className={`panel wand-sticky${isMobile && !wandStickyEnabled ? ' wand-sticky-off' : ''}`}>
        <div className="wand-sticky-head">
          <div className="wand-sticky-title">
            <span className="wand-sticky-name">{wand.name || t(lang, 'editor.title')}</span>
            {isMobile && (
              <label className="wand-sticky-toggle">
                <input
                  type="checkbox"
                  checked={wandStickyEnabled}
                  onChange={(event) => onWandStickyToggle(event.target.checked)}
                />
                <span>{t(lang, 'editor.wandSticky')}</span>
              </label>
            )}
          </div>
          <span className="panel-sub">
            {t(lang, 'editor.slotsUsed', { n: used, capacity: wand.capacity })}
          </span>
        </div>
        <div className={`wand-slots${slotsFit ? ' no-scroll' : ''}`} ref={slotsRef}>
          {slots.map((id, index) => (
            <div
              key={index}
              className={`wand-slot${id ? ' filled' : ''}${spellTarget?.kind === 'wand' && spellTarget.index === index ? ' targeted' : ''}${dragOverKey === `wand:${index}` ? ' drag-over' : ''}`}
              data-slot={index}
              data-slot-key={`wand:${index}`}
              draggable={Boolean(id)}
              onClick={() => deleteSlot('wand', index, id)}
              onDragStart={(event) => {
                if (!id) return;
                beginSlotDrag('wand', index, event);
              }}
              onDragEnd={endSlotDrag}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropToSlot(index, event)}
              onPointerEnter={(event) => {
                if (id && spellById.get(id)) hover.show(event, spellById.get(id));
              }}
              onPointerLeave={hover.hide}
            >
              {dragActive && dragSourceKey === `wand:${index}` ? (
                <span className="slot-index">{index + 1}</span>
              ) : (
                slotContent(id, index)
              )}
            </div>
          ))}
        </div>
        {alwaysCastEnabled && (
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
                  className={`wand-slot always-slot${id ? ' filled' : ''}${spellTarget?.kind === 'always' && spellTarget.index === index ? ' targeted' : ''}${dragOverKey === `always:${index}` ? ' drag-over' : ''}`}
                  data-slot-key={`always:${index}`}
                  draggable={Boolean(id)}
                  onDragStart={(event) => {
                    if (!id) return;
                    beginSlotDrag('always', index, event);
                  }}
                  onDragEnd={endSlotDrag}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDropToAlways(index, event)}
                  onClick={() => deleteSlot('always', index, id)}
                  onPointerEnter={(event) => {
                    if (spell) hover.show(event, spell);
                  }}
                  onPointerLeave={hover.hide}
                >
                  {dragActive && dragSourceKey === `always:${index}` ? (
                    <span className="slot-index">{index + 1}</span>
                  ) : id ? (
                    <>
                      {icon ? <img src={icon} alt="" draggable={false} /> : <span className="slot-index">★</span>}
                    </>
                  ) : (
                    <span className="slot-index">★</span>
                  )}
                </div>
              );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="panel wand-editor">
        <header className="panel-header">
          <h2>{t(lang, 'editor.title')}</h2>
          <span className="panel-sub">{t(lang, 'editor.settingsHint')}</span>
        </header>

        <div className="wand-toolbar">
          <select
            className="preset-select"
            value={selectedPreset}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedPreset(value);
              if (!value) return;
              const custom = customPresets.find((item) => item.id === value);
              if (custom) onChange(custom.wand);
            }}
          >
            <option value="">{t(lang, 'editor.presets')}…</option>
            {customPresets.length > 0 && (
              <optgroup label={t(lang, 'editor.myPresets')}>
                {customPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <input
            className="wand-name"
            type="text"
            placeholder={t(lang, 'editor.name')}
            value={wand.name}
            onChange={(event) => update({ name: event.target.value })}
          />
          <button type="button" className="secondary small" onClick={() => onSavePreset(presetName(), wand)}>
            {t(lang, 'editor.savePreset')}
          </button>
          {selectedCustom && (
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                onDeletePreset(selectedPreset);
                setSelectedPreset('');
              }}
            >
              {t(lang, 'editor.deletePreset')}
            </button>
          )}
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              setSelectedPreset('');
              onChange({ ...clearSpells(wand), name: '' });
            }}
          >
            {t(lang, 'editor.clear')}
          </button>
          <button
            type="button"
            className="secondary small"
            title={t(lang, 'editor.shiftLeft')}
            disabled={used < 2}
            onClick={() => onChange(shiftSpells(wand, -1))}
          >
            ←
          </button>
          <button
            type="button"
            className="secondary small"
            title={t(lang, 'editor.shiftRight')}
            disabled={used < 2}
            onClick={() => onChange(shiftSpells(wand, 1))}
          >
            →
          </button>
          <label className="field checkbox-field zero-uses-toggle">
            <input
              type="checkbox"
              checked={zeroUsesEnabled}
              onChange={(event) => onZeroUsesToggle(event.target.checked)}
            />
            <span className="field-label">{t(lang, 'editor.zeroUses')}</span>
          </label>
          <label className="field checkbox-field always-toggle">
            <input
              type="checkbox"
              checked={alwaysCastEnabled}
              onChange={(event) => onAlwaysCastToggle(event.target.checked)}
            />
            <span className="field-label">{t(lang, 'editor.alwaysCastEnabled')}</span>
          </label>
        </div>

        <div className="wand-stats">
          <NumberField
            label={t(lang, 'editor.spellsPerCast')}
            value={wand.actionsPerRound}
            min={1}
            max={MAX_CAPACITY}
            step={1}
            onChange={(value) => update({ actionsPerRound: value })}
          />
          <NumberField
            label={t(lang, 'editor.capacity')}
            value={wand.capacity}
            min={1}
            max={MAX_CAPACITY}
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
    </>
  );
}
