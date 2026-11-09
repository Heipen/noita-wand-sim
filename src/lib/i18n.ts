import type { Lang, SpellType } from './types';

type Dict = Record<string, string>;

const zh: Dict = {
  'app.title': 'Noita 魔杖模拟器',
  'app.subtitle': '直接运行游戏自带的施法逻辑，在浏览器里模拟你的魔杖',
  'app.langSwitch': 'EN',
  'import.title': '先导入你的 Noita 数据',
  'import.desc':
    '模拟器不内置任何游戏数据。请选择你本机的 Noita 安装目录（或拖入 data/data.wak），浏览器会自己解析法术、图标与脚本。',
  'import.chooseFolder': '选择 Noita 目录',
  'import.chooseFiles': '选择 data.wak 文件',
  'import.dropHint': '也可以把 data.wak（以及 common.csv）拖到这里',
  'import.privacy': '数据只保存在本机浏览器（IndexedDB），不会上传到任何服务器。',
  'import.unsupported': '你的浏览器不支持选择文件夹，请改用"选择文件"：需要 data.wak 和 data/translations/common.csv。',
  'import.stage.reading': '读取 data.wak…',
  'import.stage.parsing': '解析文件索引…',
  'import.stage.translations': '读取官方中文名…',
  'import.stage.catalog': '执行游戏 Lua，导出法术目录…',
  'import.stage.saving': '写入浏览器缓存…',
  'import.error': '导入失败',
  'import.retry': '重试',
  'stats.spells': '{n} 个法术',
  'stats.files': '{n} 个文件',
  'stats.version': '数据版本 {hash}',
  'stats.source': '来源 {source}',
  'stats.importedAt': '导入于 {time}',
  'stats.reimport': '重新导入',
  'toolbar.search': '搜索法术（中文名 / 英文名 / ID）',
  'toolbar.allTypes': '全部类型',
  'toolbar.count': '显示 {shown} / {total}',
  'spell.mana': '法力',
  'spell.uses': '次数',
  'spell.infinite': '无限',
  'spell.noSprite': '无图标',
  'type.projectile': '投射物',
  'type.static_projectile': '静态投射物',
  'type.modifier': '修正',
  'type.draw_many': '多重施放',
  'type.material': '材料',
  'type.other': '其他',
  'type.utility': '功能',
  'type.passive': '被动',
  'type.unknown': '未知',
  'footer.note': '非官方项目，与 Nolla Games 无关。游戏数据版权归 Nolla Games。',
  'common.loading': '加载中…',
  'stats.useLocal': '使用本地数据',
  'stats.useBundled': '使用内置数据',
  'import.backToBundled': '返回内置数据',
  'import.introImport': '你也可以导入自己游戏目录里的数据（版本更新 / 打了模组时用）',
};

const en: Dict = {
  'app.title': 'Noita Wand Simulator',
  'app.subtitle': "Runs the game's own casting logic to simulate your wands in the browser",
  'app.langSwitch': '中文',
  'import.title': 'Import your Noita data first',
  'import.desc':
    'No game data is bundled. Pick your local Noita install folder (or drop data/data.wak); the browser parses spells, icons and scripts locally.',
  'import.chooseFolder': 'Choose Noita folder',
  'import.chooseFiles': 'Choose data.wak',
  'import.dropHint': 'You can also drop data.wak (and common.csv) here',
  'import.privacy': 'Data stays in your browser (IndexedDB). Nothing is uploaded.',
  'import.unsupported':
    'This browser cannot pick folders. Use "Choose data.wak" instead (plus data/translations/common.csv).',
  'import.stage.reading': 'Reading data.wak…',
  'import.stage.parsing': 'Parsing file index…',
  'import.stage.translations': 'Reading translations…',
  'import.stage.catalog': "Running the game's Lua to extract spells…",
  'import.stage.saving': 'Caching locally…',
  'import.error': 'Import failed',
  'import.retry': 'Retry',
  'stats.spells': '{n} spells',
  'stats.files': '{n} files',
  'stats.version': 'data {hash}',
  'stats.source': 'from {source}',
  'stats.importedAt': 'imported {time}',
  'stats.reimport': 'Re-import',
  'toolbar.search': 'Search spells (name / ID)',
  'toolbar.allTypes': 'All types',
  'toolbar.count': 'Showing {shown} / {total}',
  'spell.mana': 'Mana',
  'spell.uses': 'Uses',
  'spell.infinite': '∞',
  'spell.noSprite': 'No icon',
  'type.projectile': 'Projectile',
  'type.static_projectile': 'Static projectile',
  'type.modifier': 'Modifier',
  'type.draw_many': 'Multicast',
  'type.material': 'Material',
  'type.other': 'Other',
  'type.utility': 'Utility',
  'type.passive': 'Passive',
  'type.unknown': 'Unknown',
  'footer.note': 'Unofficial project, not affiliated with Nolla Games. Game data © Nolla Games.',
  'common.loading': 'Loading…',
  'stats.useLocal': 'Use local data',
  'stats.useBundled': 'Use bundled data',
  'import.backToBundled': 'Back to bundled data',
  'import.introImport': 'You can also import data from your own game folder (for new versions / modded data)',
};

const DICTS: Record<Lang, Dict> = { zh, en };

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const template = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function spellTypeLabel(lang: Lang, type: SpellType): string {
  return t(lang, `type.${type}`);
}
