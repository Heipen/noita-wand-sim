# scripts/data

## wiki-unlocks-zh.json

`gameID -> 解锁条件` 映射，用于法术悬浮窗的「解锁」一行。

- 来源：中文 Noita Wiki 的 Cargo 表 `Spells.unlockCondition`
  （https://noita.wiki.gg/zh/api.php?action=cargoquery&tables=Spells ）。
- 许可：Wiki 内容为 **CC BY-NC-SA 3.0**，使用时需署名；本项目仅在数据包中引用 97 条
  短句（如「找到实验性魔杖」「击杀古代炼金术师」），不改写、不商用，并在 README 中署名。
- 重新生成：`node scripts/prepare-unlocks.mjs`（读取 `D:/project/noita/reference/wiki-unlocks-zh.json`
  的原始 Cargo 响应，清洗 wiki 链接后写出本文件）。

> 游戏本体数据（法术名/描述/数值/图标）来自 `data.wak`，不在此目录。
