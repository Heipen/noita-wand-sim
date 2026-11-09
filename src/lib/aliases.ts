/**
 * Community Chinese names from the Chinese Noita Wiki guides (中文 Noita Wiki「攻略」).
 * The in-game official zh-cn translations are kept in common.csv; for some spells they are
 * confusing (e.g. Omega → "终结", Alpha → "初始"), so the UI prefers community names and
 * shows the official one in the tooltip.
 */
export const ZH_COMMUNITY_NAMES: Record<string, string> = {
  ALPHA: '阿尔法',
  GAMMA: '伽马',
  TAU: '陶',
  MU: '缪',
  PHI: '斐',
  SIGMA: '西格玛',
  ZETA: '泽塔',
  OMEGA: '欧米伽',
  RESET: '魔杖刷新',
  SPELLS_TO_POWER: '法术变力量',
  DUPLICATE: '法术复制',
  ADD_TRIGGER: '追加触发',
  ADD_TIMER: '追加计时',
  ADD_DEATH_TRIGGER: '追加失效触发',
  DIVIDE_2: '一分为二',
  DIVIDE_3: '一分为三',
  DIVIDE_4: '一分为四',
  DIVIDE_10: '一分为十',
  LIGHT_BULLET: '火花弹',
  LIGHT_BULLET_TRIGGER: '触发火花弹',
  CHAINSAW: '链锯',
  HEAVY_SHOT: '沉重一击',
  HOMING: '追踪',
};

/** Extra tooltip text explaining a community name / nickname. */
export const ZH_ALIAS_NOTES: Record<string, string> = {
  ALPHA: '官方译名：初始',
  GAMMA: '官方译名：伽马校正',
  OMEGA: '官方译名：终结',
  MU: '官方译名：谬',
  RESET: '俗称：刷新环',
  SPELLS_TO_POWER: '俗称：法转力',
};
