# Noita 法杖模拟器 / Noita Wand Simulator

> **在线站点**：https://heipen.github.io/noita-wand-sim/ —— 打开即用，无需安装或导入数据
> **GitHub 仓库**：https://github.com/Heipen/noita-wand-sim —— 如果觉得有用，欢迎点个 **Star ⭐**

在浏览器里模拟 **Noita** 的法杖施法：自己往法杖里装法术，看它到底会怎么施放。

核心思路不是照着 Wiki 重写规则，而是**直接运行游戏自带的施法 Lua**（`data/scripts/gun/gun.lua` + `gun_actions.lua`）。牌堆、抽取、递归、一分为多、追加触发、回绕等复杂机制都来自游戏原版脚本，因此模拟结果与游戏同源。

> ⚠️ 非官方项目，与 Nolla Games 无关。站点内置数据包中的法术名、描述、图标、施法 Lua、投射物 XML 等来自 Noita 游戏，版权归 **Nolla Games** 所有；本项目仅用于互操作性研究与工具用途，不做商业使用。若权利方要求，可随时移除数据包。

## 功能

- **直接运行游戏 Lua**：在浏览器内的 Lua VM（fengari）中执行原版施法脚本。
- **法杖编辑器**：设置法术数/施放、容量、施放延迟、充能时间、法力、乱序等属性，拖拽或点击装配法术。
- **施法树**：完整展示抽取、执行、修正、触发载荷、弃牌、回绕等过程。
- **牌堆状态**：显示牌库、手牌区、弃牌堆；点击施法树中的步骤，可查看该步骤执行时的牌堆快照。
- **施法动作汇总**：按施法块汇总本次施法的动作，重复法术自动合并为 `×N`，并区分主施法块与触发载荷。
- **法术悬浮窗**：显示类型、法力消耗、施放延迟、充能、使用次数、法术等级、生成权重、解锁条件、法术伤害与修正效果等。
- **中英切换**、**移动端适配**、**URL 分享**（兼容 Wiki 的 v2 Tinker 参数）。
- 支持一次施法与“连发到充能”两种模拟模式。

## 数据来源

站点自带的数据包（`public/data`）由 `npm run build:data` 从本机 Noita 安装中生成，主要包含：

| 内容 | 来源 |
|---|---|
| 法术目录、静态字段、法力/次数等 | 游戏 `data.wak` 中的 `gun_actions.lua` 等脚本 |
| 施放延迟、充能、shot state 修正 | 游戏原版 Lua 的 reflection pass |
| 法术图标、投射物 XML | 游戏资源与实体定义 |
| 官方简中法术名 | 游戏 `common.csv` 翻译文件 |
| 中文解锁条件 | 中文 Noita Wiki 的 Cargo 数据（CC BY-NC-SA 3.0） |

游戏数据与素材版权归 **Nolla Games** 所有。本仓库代码以 MIT 许可证开源；数据包不包含游戏本体，仅保留运行模拟所需的最小文件。

## 启发与致谢

本项目的界面与交互思路受到 **Noita Wand Simulator** 的启发：

- https://noita-wand-simulator.salinecitrine.com

感谢它展示了在浏览器中探索法杖施法过程的可能。本项目采用“直接执行游戏 Lua”的实现路线，并在此基础上加入了施法树、逐步牌堆快照、施法动作汇总等功能。

## 技术栈

- Vite + React + TypeScript
- fengari（Lua 5.3 VM），在 Web Worker 中运行游戏脚本
- Vitest 单元/集成测试 + 基于 CDP 的浏览器端 E2E

## 本地开发

```bash
npm install
npm run dev        # 本地开发服务器
npm run build      # 产出 dist/
npm test           # vitest
npm run build:data # 从本机 Noita 重新生成 public/data
```

浏览器端到端测试（可选，需要本机安装 Edge/Chrome）：

```bash
npm run build && npx vite preview --port 4173
# 另开终端，启动带 --remote-debugging-port=9222 的浏览器
npm run e2e
```

## License

MIT（仅本仓库代码）。Noita 游戏数据与素材版权归 Nolla Games 所有。
