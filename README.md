# 班级排座位软件

[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/xiaochaZ/seat-arranger)](https://github.com/xiaochaZ/seat-arranger/releases)
[![GitHub stars](https://img.shields.io/github/stars/xiaochaZ/seat-arranger)](https://github.com/xiaochaZ/seat-arranger)
[![纯前端 · 零依赖](https://img.shields.io/badge/纯前端-零依赖-brightgreen.svg)](index.html)

一款给班主任用的**班级排座位 Web 工具**：导入名单 → 配置布局/规则 → 加权约束算法自动生成多套座位表 → 可视化微调 → 导出图片/Excel。

- **纯前端、零构建、零依赖**：双击 `index.html` 浏览器打开即用，无 npm、无服务器、完全离线。
- 数据存浏览器 localStorage（不上传），支持 JSON 备份/恢复。
- 支持安装为桌面应用（Chrome/Edge 菜单 → 安装为应用）。

> 📷 截图占位：四步向导 + 座位网格 + 违规面板（后续可替换为实际截图）

## 功能一览

- **名单**：手动添加 / 粘贴导入 / Excel(.xlsx)/CSV/文本导入（智能识别"姓名/学号/性别/身高/备注"列，表头行可不在第一行）、多班级、清空名单
- **布局**：排数/列数实时调整、多过道（逗号分隔，如 `2,4,6`=xx|xx|xx|xx、`2,5,7`=xx|xxx|xx|xx 含 3 列组）、门方向（左/右，座位号从门那边数）、区域框选、不可用座位（右键标记）、座位坐标 (排,列)
- **规则**：同桌（2 人或 3 人连排）、隔离（不同桌 / 曼哈顿距离 / 横向+竖向距离）、区域、禁坐；每条权重 0~100 + 硬约束开关
- **算法**：模拟退火 + 增量代价评估 + 聚焦扰动 + 定向修复（硬约束同桌 2/3 人可靠收敛）；一次生成多套方案（默认 10），按总代价排序去重
- **可视化**：座位网格（区域底色/同桌同色+标签/违规红框）、方案列表、规则满足状态列表（✓绿/✗红）、违规报告（点击定位闪烁）、拖拽交换即时提示
- **导出**：PNG 高清图（含门/过道/同桌色）、Excel 座位表(.xlsx)、JSON 备份/恢复

## 快速上手（四步）

1. **名单**：粘贴或导入 Excel/CSV/文本，自动识别表头列
2. **布局**：设排数/列数/门位置/过道，框选区域，右键标不可用座
3. **规则**：设同桌/隔离/区域/禁坐，每条带权重（0~100）或硬约束
4. **排座**：🎲 一键生成多套方案，拖拽微调，导出 PNG/Excel

详细操作见 **[使用说明.html](使用说明.html)**。

## 技术要点

- 纯原生 JavaScript，全局 `Seat` 命名空间，按依赖顺序 `<script>` 加载（不用 ES Modules，保证 `file://` 协议可运行）
- 算法：cost.js 增量评估器 `createIncremental`（交换只重算涉及规则）+ anneal.js 模拟退火（T0=80/TEnd=0.5/alpha=0.992）+ 多次随机重启
- 数据模型：`layout = { rows, cols, aisles, doorSide, unavailable, areas }`，座位 key = `r{排}c{列}`
- Excel 读写：lib/xlsx.full.min.js（SheetJS 0.18.5，本地化无 CDN 依赖）

## 测试

```bash
node test/algorithm.test.js   # 算法单测 22/22
```

## 项目结构

```
座位表/
├── index.html              入口（四步向导：名单→布局→规则→排座）
├── css/style.css           全部样式
├── js/                     11 个功能模块（原生 JS，全局 Seat 命名空间）
├── lib/xlsx.full.min.js    SheetJS 0.18.5（Excel 读写）
├── test/                   算法单测 / 性能压测 / 工具脚本
├── 使用说明.html
```

## 开源协议

本项目基于 [BSD 3-Clause License](LICENSE) 开源，欢迎使用、修改与二次分发（保留版权声明即可）。

## 已知限制 / 后续方向

- 规则类型为 MVP 四类（同桌/隔离/区域/禁坐）；V2 可加：性别/身高/帮扶、固定座位、每排不同布局
- 算法对"多组 3 人硬约束同桌"有定向修复保障，极端冲突场景会标记"未满足硬约束"
- 项目为单人单机使用；如需多人协作可后续加后端/云存储
