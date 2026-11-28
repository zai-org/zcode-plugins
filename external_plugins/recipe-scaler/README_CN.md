# 菜谱换算

把一文件夹的菜谱按人数缩放、换算单位，得到合并好的购物清单和可打印的菜谱卡片。读取中英文 Markdown 菜谱（五花肉 500 g、生抽 2 汤匙、鸡蛋 3 个、盐 适量、1 1/2 cups flour），每道菜可各自设人数或统一人数，可换成公制（克、毫升）或美制（oz、cup），取整合理：鸡蛋番茄取整个、勺按 1/4、克取整到 5。购物清单把几道菜里的同一样食材加在一起（鸡蛋 / eggs、番茄 / 西红柿），按货架分组，家里已有的不列入。会发现没写份量的菜谱、读不懂的数量（如 两三）、不认识的单位、重复的食材、步骤里没用到的食材、没有步骤的菜谱，以及放大太多需要尝味的调味。导出 A5 菜谱卡片（换算后用量、步骤、总时长）、带勾选框的购物清单 PDF、CSV 和换算后的 Markdown 菜谱。不用登录，无需 API 密钥，本机运行。

## 功能

- **缩放**：每道菜单独设人数或统一人数；鸡蛋、勺、克取整合理。
- **单位**：保持原单位、公制（克、毫升）或美制（oz、cup）；认识 斤、两、汤匙、茶匙。
- **购物清单**：多道菜同一食材合并、按货架分组、家里已有的不列入。
- **检查**：缺份量、读不懂的数量、未知单位、重复食材、步骤没用到的食材。
- **导出**：A5 菜谱卡片、购物清单 PDF/CSV、换算后的 Markdown。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `recipe-scaler/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 recipes 里的菜谱都换算成 6 人份”
- “把这几道菜合成一张购物清单”
- “导出菜谱卡片和购物清单”

## 工具

| 工具 | 作用 |
|---|---|
| `recipe_open` | 读取菜谱并按人数换算，并打开面板 |
| `recipe_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `recipe_status` | 查看当前数据、问题和汇总 |
| `recipe_export` | 导出 recipe-cards.pdf、shopping-list.pdf、shopping-list.csv 和 recipes-scaled.md |

导出文件写到工作区的 `recipe-scaler/<项目>/` 文件夹。

## 范围（v0.1）

- 同一食材的重量和体积不互相换算（没有密度表）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `recipe-scaler/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/recipe-scaler/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-recipe-scaler test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
