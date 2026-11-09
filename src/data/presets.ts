import { createEmptyWand, normalizeWand, type WandState } from '../lib/wand';

export interface WandPreset {
  id: string;
  nameZh: string;
  nameEn: string;
  wand: WandState;
}

function makeWand(
  name: string,
  spells: string[],
  options: Partial<WandState> = {},
  alwaysCast: string[] = [],
): WandState {
  const wand = createEmptyWand();
  wand.name = name;
  wand.capacity = Math.max(1, spells.length);
  spells.forEach((id, index) => {
    wand.spells[index] = id;
  });
  alwaysCast.forEach((id, index) => {
    wand.alwaysCast[index] = id;
  });
  return normalizeWand({ ...wand, ...options });
}

export const PRESETS: WandPreset[] = [
  {
    id: 'trigger-bomb',
    nameZh: '触发火花弹',
    nameEn: 'Trigger spark bolt',
    wand: makeWand('触发火花弹', ['LIGHT_BULLET_TRIGGER', 'BOMB'], {
      actionsPerRound: 1,
      castDelayFrames: 10,
      rechargeFrames: 29,
      manaMax: 250,
      manaChargeSpeed: 200,
    }),
  },
  {
    id: 'double-damage',
    nameZh: '二重伤害弹',
    nameEn: 'Double damage bolts',
    wand: makeWand('二重伤害弹', ['DAMAGE', 'LIGHT_BULLET', 'LIGHT_BULLET'], {
      capacity: 4,
      actionsPerRound: 2,
      castDelayFrames: 20,
      rechargeFrames: 45,
      manaMax: 300,
      manaChargeSpeed: 150,
    }),
  },
  {
    id: 'divide-two',
    nameZh: '一分为二',
    nameEn: 'Divide by 2',
    wand: makeWand('一分为二', ['DIVIDE_2', 'LIGHT_BULLET'], {
      castDelayFrames: 0,
      rechargeFrames: 40,
      manaMax: 500,
      manaChargeSpeed: 300,
    }),
  },
  {
    id: 'machinegun',
    nameZh: '机枪杖',
    nameEn: 'Machine gun wand',
    wand: makeWand('机枪杖', ['LIGHT_BULLET', 'CHAINSAW'], {
      actionsPerRound: 2,
      castDelayFrames: 0,
      rechargeFrames: 30,
      manaMax: 1000,
      manaChargeSpeed: 500,
    }),
  },
  {
    id: 'divide-ten',
    nameZh: '一分为十（800 份）',
    nameEn: 'Divide by 10 chain',
    wand: makeWand('一分为十', ['DIVIDE_10', 'DIVIDE_10', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'], {
      castDelayFrames: 0,
      rechargeFrames: 80,
      manaMax: 20000,
      manaChargeSpeed: 2000,
    }),
  },
  {
    id: 'refresh-ring',
    nameZh: '刷新环循环',
    nameEn: 'Wand refresh loop',
    wand: makeWand('刷新环循环', ['DIVIDE_2', 'LIGHT_BULLET', 'RESET', 'LIGHT_BULLET'], {
      castDelayFrames: 0,
      rechargeFrames: 30,
      manaMax: 500,
      manaChargeSpeed: 300,
    }),
  },
];
