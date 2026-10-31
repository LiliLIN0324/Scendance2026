# modern-ui-agent-skills

给 Cursor / Trae / Codex 用的现代 UI Agent Skills 打包仓（幕景 Scendance 工作台可用）。

## 里面有什么

| 路径 | 来源 | 用途 |
|------|------|------|
| `skills/ui-design-brain/` | fork of [carmahhawwari/ui-design-brain](https://github.com/carmahhawwari/ui-design-brain)（MIT） | 60+ 组件模式，反 AI 烂 UI |
| `skills/ui-ux-kit/` | fork of [arham777/ui-ux-kit](https://github.com/arham777/ui-ux-kit)（MIT） | 口味优先 + anti-slop 闸 |
| `skills/scendance-chrome-gate/` | 本仓 | 幕景工作台 chrome：禁只洗 CSS、强制 DOM+diff 验收 |

上游独立 fork（可单独给 agent）：

- https://github.com/LiliLIN0324/ui-design-brain
- https://github.com/LiliLIN0324/ui-ux-kit

## 怎么给 Trae / Cursor

把本仓 clone 进项目或让 agent 读：

```text
先读 https://github.com/LiliLIN0324/modern-ui-agent-skills
务必遵守 skills/scendance-chrome-gate/SKILL.md
组件与反模式参考 skills/ui-design-brain/
口味闸参考 skills/ui-ux-kit/
```

或只贴 gate + 两个 fork 链接。

## 许可

- `ui-design-brain` / `ui-ux-kit`：各自 LICENSE（MIT），保留原版权声明
- `scendance-chrome-gate`：与本 README 一并可用于幕景项目
