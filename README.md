# Noita 魔杖模拟器 / Noita Wand Simulator

在浏览器里模拟 **Noita** 的魔杖施法：自己往魔杖里装法术，看它到底会怎么施放。
核心思路不是"照着 Wiki 重写规则"，而是**直接运行游戏自带的施法 Lua**（`data/scripts/gun/gun.lua` + `gun_actions.lua`），所以牌堆、抽取、递归、一分为多、追加触发等复杂机制与游戏同源。

> ⚠️ 非官方项目，与 Nolla Games 无关。仓库**不含**任何游戏代码/数据/美术素材；数据由你在浏览器本地从自己的 Noita 安装导入，不会上传。

## 当前状态

- [x] **M0 数据导入**：浏览器内解析 `data/data.wak`（42 MB，纯前端），读取 `git` 脚本与法术图标，执行游戏 Lua 导出 **422 个法术**元数据（官方简中名 + 社区惯用名）。
- [ ] M1 规则引擎（施法树、卡组、递归、Divide、触发器…）
- [ ] M2 网页 MVP（魔杖编辑器 + 施法树 + 数值面板，中英切换）
- [ ] M3 弹体实际数值校准（以游戏内日志为准）
- [ ] M4 2D 飞行演示（可选）

详细计划见 [docs/PLAN.md](docs/PLAN.md)，中文术语与文案规范见 [docs/术语表.md](docs/术语表.md)。

## 使用

1. 打开站点（或本地 `npm run dev`）。
2. 首次进入点"选择 Noita 目录"（Chrome/Edge 支持直接选文件夹；其他浏览器可拖入 `data/data.wak` + `data/translations/common.csv`）。
3. 数据会缓存在浏览器 IndexedDB 里，下次打开无需重新导入。游戏更新后按提示重新导入即可。

数据只留在本机：不上传、不经服务器、不写入仓库。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产出 dist/
npm test           # vitest（含用本机游戏数据跑的真实数据集成测试）
```

如果本机装了 Noita（默认路径 `C:\Program Files\Steam\steamapps\common\Noita`），`npm test` 会读取该目录的 `data/data.wak` 做集成校验；没有安装则自动跳过。

## 目录

```
src/
  lib/wak.ts          data.wak 解析（16 字节头 + 文件索引）
  lib/catalog.ts      用 fengari 执行游戏 gun_actions.lua，导出法术目录
  lib/localization.ts common.csv 官方简中/英文名 + 社区惯用别名
  lib/import.ts       文件夹/文件导入 + IndexedDB 缓存
  lib/i18n.ts         中英文 UI 文案（key = 英文术语 ID）
  components/         UI
docs/                 计划与术语表
```

## License

MIT（仅本仓库代码）。游戏数据与素材版权归 Nolla Games。
