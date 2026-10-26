# 主页模板（Template Presets）

每个 JSON 是一套**完整可落地的主页视觉模板**，字段与 `design/tokens.json` 同构：
`color` 用语义名（不写组件级裸色），`radius`/`spacing` 只取现有档位，`shadow` 描述层级。

## 使用方式

模板不是新设计语言，而是**同一套组件的不同参数组合**：

| 字段 | 作用 |
|---|---|
| `layout.hero` | `gradient` / `solid` / `plain` —— 净资产区的形态 |
| `layout.list` | `card`（白卡包裹）/ `flat`（无容器，靠分隔线） |
| `layout.tab` | `pill`（悬浮圆角）/ `flat`（贴底通栏）/ `minimal`（纯文字） |
| `layout.density` | `comfortable` / `compact` —— 行高与区块间距 |
| `radius` | 只允许 4 / 8 / 12 / 14 / 16 / 18 / 22 / 24 |
| `accent` | 单色强调（模板内不超过 1 个彩色强调） |

落地时把 JSON 的 `color.*` 映射到 `src/theme/theme.ts` 的 `lightSemantic`/`darkSemantic`
同名字段，`layout.*` 映射为页面级的条件渲染，**不新增裸 hex**。
