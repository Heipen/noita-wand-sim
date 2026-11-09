# Noita 魔杖模拟器 / Noita Wand Simulator

> **在线站点**：https://heipen.github.io/noita-wand-sim/ —— 打开即用，无需导入数据
> 当前进度：M0.5（内置数据包 + 法术目录完成；规则引擎开发中）

在浏览器里模拟 **Noita** 的魔杖施法：自己往魔杖里装法术，看它到底会怎么施放。
核心思路不是"照着 Wiki 重写规则"，而是**直接运行游戏自带的施法 Lua**（`data/scripts/gun/gun.lua` + `gun_actions.lua`），所以牌堆、抽取、递归、一分为多、追加触发等复杂机制与游戏同源。

> ⚠️ 非官方项目，与 Nolla Games 无关。站点内置的数据包（法术名/描述/图标/施法 Lua/投射物 XML）来自 Noita 游戏，版权归 **Nolla Games** 所有；本项目仅用于互操作性研究与工具用途，不做商业使用。若权利方要求，可随时移除数据包（见下文"数据包"）。

## 当前状态

- [x] **M0 数据层**：浏览器内解析 `data/data.wak`（纯前端）、执行游戏自带 Lua 导出 **422 个法术**（官方简中名 + 社区惯用名）、中英切换、图标/搜索/类型筛选。
- [x] **M0.5 内置数据包**：站点自带 2.3 MB 数据包（法术目录 + 422 图标 + 施法 Lua + 投射物 XML），**打开即用**；也保留"使用本地数据"入口，游戏更新/打模组时可导入自己的 `data.wak`。
- [ ] M1 规则引擎（施法树、卡组、递归、Divide、触发器…）
- [ ] M2 网页 MVP（魔杖编辑器 + 施法树 + 数值面板）
- [ ] M3 弹体实际数值校准（以游戏内日志为准）
- [ ] M4 2D 飞行演示（可选）

详细计划见 [docs/PLAN.md](docs/PLAN.md)，中文术语与文案规范见 [docs/术语表.md](docs/术语表.md)。

## 使用

打开 https://heipen.github.io/noita-wand-sim/ 即可，内置数据会自动加载。

想换成自己游戏的数据（版本不同 / 装了模组）：
1. 点统计栏的 **"使用本地数据"**；
2. 选择 Noita 安装目录（Chrome/Edge 可直接选文件夹；其他浏览器可拖入 `data/data.wak` + `data/translations/common.csv`）；
3. 数据只在你的浏览器里解析（IndexedDB 缓存），点 **"使用内置数据"** 可随时切回。

## 数据包（public/data）

由 `npm run build:data` 从本机 Noita 生成（默认 Steam 路径，可用 `NOITA_DIR` 覆盖）：

| 内容 | 大小 |
|---|---|
| `spells.json`（422 个法术：名称/描述/类型/蓝耗/次数/相关投射物） | ~247 KB |
| `sprites/*.png`（422 个法术图标） | ~243 KB |
| `game/scripts/...`（施法 Lua：`gun.lua`、`gun_actions.lua` 等） | ~700 KB |
| `game/entities/...`（投射物 XML + 自定义卡，供数值层用） | ~1.2 MB |
| 合计 | **~2.35 MB**（不含音频/贴图库，不是游戏本体） |

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
src/components/              UI
public/data/                 内置数据包（由脚本生成，见上）
docs/                        计划与术语表
```

## License

MIT（仅本仓库代码）。游戏数据与素材版权归 Nolla Games。
