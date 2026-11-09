# Noita 魔杖模拟器 / Noita Wand Simulator

> **在线站点**：https://heipen.github.io/noita-wand-sim/ —— 打开即用，无需导入数据
> 当前进度：M0.5（内置数据包 + 法术目录完成；规则引擎开发中）

在浏览器里模拟 **Noita** 的魔杖施法：自己往魔杖里装法术，看它到底会怎么施放。
核心思路不是"照着 Wiki 重写规则"，而是**直接运行游戏自带的施法 Lua**（`data/scripts/gun/gun.lua` + `gun_actions.lua`），所以牌堆、抽取、递归、一分为多、追加触发等复杂机制与游戏同源。

> ⚠️ 非官方项目，与 Nolla Games 无关。站点内置的数据包（法术名/描述/图标/施法 Lua/投射物 XML）来自 Noita 游戏，版权归 **Nolla Games** 所有；本项目仅用于互操作性研究与工具用途，不做商业使用。若权利方要求，可随时移除数据包（见下文"数据包"）。

## 当前状态

- [x] **M0 数据层**：浏览器内解析 `data/data.wak`（纯前端）、执行游戏自带 Lua 导出 **422 个法术**（官方简中名 + 社区惯用名）、中英切换、图标/搜索/类型筛选。
- [x] **M0.5 内置数据包**：站点自带 2.3 MB 数据包（法术目录 + 422 图标 + 施法 Lua + 投射物 XML），**打开即用**；也保留"使用本地数据"入口，游戏更新/打模组时可导入自己的 `data.wak`。
- [x] **M0.6 悬浮窗数据**：已采集游戏内法术悬浮窗所需的全部字段（类型/法力消耗/施放延迟/使用次数/解锁/法术等级/生成权重 + 全部 shot state 变化），UI 在 M2 的选法术面板里实现，设计见 [docs/法术悬浮窗设计.md](docs/法术悬浮窗设计.md)。
- [x] **M1 规则引擎**：在 Lua VM（fengari）里执行游戏原版 `gun.lua`/`gun_actions.lua`，输出施法树 + 事件流 + shot state；覆盖触发器、一分为多（含 800 份迭代上限）、字符法术、Always Cast、乱序、帧/法力/充能；15 个引擎测试（全仓 28 个）。文档见 [docs/规则引擎.md](docs/规则引擎.md)。
- [x] **M2 网页 MVP**：魔杖编辑器（拖拽/属性/26 槽/Always Cast/预设）、带游戏内样式悬浮窗的选法术面板、施法树 + 牌堆三区 + 预载事件流 + 施法状态、单次/连发到充能、中英切换、URL 分享（兼容 Wiki v2 参数）；引擎跑在 Web Worker 里。
- [ ] M3 弹体实际数值校准（以游戏内日志为准）
- [ ] M4 2D 飞行演示（可选）

详细计划见 [docs/PLAN.md](docs/PLAN.md)，中文术语与文案规范见 [docs/术语表.md](docs/术语表.md)。

## 规则引擎（M1）

```ts
import { createWandEngine, bundledScriptSource } from './src/engine';

const engine = await createWandEngine(bundledScriptSource());
const result = engine.simulate({
  actions_per_round: 1,
  shuffle_deck_when_empty: false,
  reload_time: 40, deck_capacity: 10,
  spells: ['LIGHT_BULLET_TRIGGER', 'BOMB'],
});
console.log(result.shots[0].block);   // 施法树
console.log(result.shots[0].events);  // 预载过程/抽取/执行事件
```

引擎不重写任何施法规则：它执行数据包里的游戏 Lua，只提供引擎 API、事件记录、Noita RNG 与实体 mock。完整字段/事件/局限见 [docs/规则引擎.md](docs/规则引擎.md)。

## 使用

打开 https://heipen.github.io/noita-wand-sim/ 即可，内置数据会自动加载。

**模拟器操作**

1. **魔杖**：左侧设置法术数/施放、容量、施法延迟、充能时间、法力、乱序、始终施放；或从"预设"里选一套示例。
2. **装法术**：右侧选择法术面板支持点击（加到第一个空槽）和拖拽（拖到任意槽位，槽位之间也可拖动交换）；悬停 0.4 秒会弹出**与游戏内一致的悬浮窗**（类型/法力消耗/施放延迟/使用次数/解锁/法术等级/生成权重）。
3. **施法结果**：下方显示施法树（含触发器嵌套）、牌堆三区（牌库/手牌区/弃牌堆）、预载过程事件流、施法状态修正；可切换"施放一次 / 连发到充能"。
4. **分享**：URL 会实时同步魔杖参数（兼容 Wiki 的 v2 Tinker 参数），可直接把链接发给别人或粘贴 Wiki 魔杖链接打开。

想换成自己游戏的数据（版本不同 / 装了模组）：
1. 点统计栏的 **"使用本地数据"**；
2. 选择 Noita 安装目录（Chrome/Edge 可直接选文件夹；其他浏览器可拖入 `data/data.wak` + `data/translations/common.csv`）；
3. 数据只在你的浏览器里解析（IndexedDB 缓存），点 **"使用内置数据"** 可随时切回。

## 数据包（public/data）

由 `npm run build:data` 从本机 Noita 生成（默认 Steam 路径，可用 `NOITA_DIR` 覆盖）：

| 内容 | 大小 |
|---|---|
| `spells.json`（422 个法术：名称/描述/类型/蓝耗/次数/相关投射物 + 悬浮窗字段） | ~371 KB |
| `sprites/*.png`（422 个法术图标） | ~243 KB |
| `game/scripts/...`（施法 Lua：`gun.lua`、`gun_actions.lua` 等） | ~700 KB |
| `game/entities/...`（投射物 XML + 自定义卡，供数值层用） | ~1.2 MB |
| 合计 | **~2.47 MB**（不含音频/贴图库，不是游戏本体） |

### 悬浮窗字段（M0.6 已就绪）

游戏内法术卡悬浮窗显示的信息，已全部采集进 `spells.json`：

| 悬浮窗项 | 字段 | 说明 |
|---|---|---|
| 类型 | `type` | 官方标签：投射物 / 静态投射物 / **投射修正** / 多重施放 / 材料 / 其他 / 实用 / 被动 |
| 法力消耗 | `mana` | 可为负（如额外法力 -30） |
| 施放延迟 | `castDelayFrames` | 帧（60fps），UI 换算成秒：`-8 → -0.13` |
| 充能时间 | `reloadFrames` | 帧，如缩减充能时间 = -20 帧（-0.33s） |
| 使用次数 | `maxUses` | 仅限次法术 |
| 解锁 | `unlockZh` / `unlockFlag` | 中文解锁条件（97 条，来自中文 Wiki Cargo，CC BY-NC-SA 3.0） |
| 法术等级 | `spawnLevel` | 如 `"2,3,4,10"` |
| 对应等级生成权重 | `spawnProbability` | 如 `"0.1,0.1,0.1,0.2"` |
| 其他修正数值 | `stateDelta` | 伤害/散射/速度/暴击等全部非默认 shot state |

采集方式：静态字段来自 `gun_actions.lua`；施放延迟/充能等来自与游戏 `gun_collect_metadata.lua` 同款的 **reflection pass**（`reflecting=true` 下逐个执行法术 action 并记录 shot state），因此与游戏内数值同源。

版权归 Nolla Games；如果你是该权利方并希望移除，请开 issue 或联系仓库作者，会立刻删除数据包（代码本身仍可配合"使用本地数据"运行）。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build:data # 从本机 Noita 重新生成 public/data（游戏更新后跑一次）
npm test           # vitest：单元 + 真实数据集成 + 数据包完整性
npm run build      # 产出 dist/
```

如果本机装了 Noita（默认路径 `C:\Program Files\Steam\steamapps\common\Noita`），`npm test` 会额外用真实 `data.wak` 做集成校验；没安装则自动跳过。

浏览器端到端测试（可选，需要 Edge/Chrome + 本机 Noita）：

```bash
npm run build && npx vite preview --port 4173   # 终端 A
# 终端 B：启动 headless Edge，带 --remote-debugging-port=9222
npm run e2e
```

## 目录

```
scripts/build-data-pack.ts   从本机 Noita 生成 public/data 数据包
scripts/e2e-m0.mjs           浏览器 E2E（CDP）
src/lib/wak.ts               data.wak 解析（16 字节头 + 文件索引）
src/lib/catalog.ts           用 fengari 执行游戏 gun_actions.lua，导出法术目录
src/lib/bundledData.ts       加载内置数据包（打开即用）
src/lib/gameData.ts          本地导入 + IndexedDB 缓存
src/lib/i18n.ts              中英文 UI 文案（key = 英文术语 ID）
src/engine/                 规则引擎（M1）
src/components/              UI
public/data/                 内置数据包（由脚本生成，见上）
scripts/build-data-pack.ts   从本机 Noita 生成 public/data
scripts/data/                解锁条件映射（中文 Wiki Cargo，CC BY-NC-SA 3.0）
docs/                        计划、术语表、悬浮窗设计
```

## License

MIT（仅本仓库代码）。游戏数据与素材版权归 Nolla Games。
