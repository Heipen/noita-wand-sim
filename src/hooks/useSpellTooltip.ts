import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpellMeta } from '../lib/types';

export interface TooltipState {
  spell: SpellMeta;
  x: number;
  y: number;
}

/**
 * Show a tooltip after hovering for a while (game-like 400 ms), anchored to the element.
 * Returns handlers to spread on the hover target.
 */
export function useSpellTooltip(delayMs = 400) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setTooltip(null);
  }, []);

  const show = useCallback(
    (event: { currentTarget: HTMLElement }, spell: SpellMeta | undefined) => {
      if (!spell) return;
      window.clearTimeout(timer.current);
      const target = event.currentTarget;
      timer.current = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        setTooltip({ spell, x: rect.right + 10, y: rect.top });
      }, delayMs);
    },
    [delayMs],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { tooltip, show, hide };
}
