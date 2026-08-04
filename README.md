# AI文创快速生产系统 — Creative Manufacturing OS

> MVP v0.1 | 线下文创产品生产管理闭环

## 项目简介

将"游客体验 → 订单生成 → 图片处理 → 生产管理 → 库存管理 → 打印制作 → 成品交付"数字化闭环的生产管理系统。

当前阶段：**Phase 0 + Phase 1 MVP 基础模块 + Phase 1.5 产品主数据（Master SKU）**。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + Vite 6 + TypeScript 5.6 |
| 后端 | Node.js + Express 4 + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 图片处理 | Konva.js（纯 JS Canvas 库，替代原生 Canvas 实现，避免 Fabric.js 原生编译问题） |
| 产品主数据 | `sku.template.json` 驱动（Master SKU 体系，Phase 1.5） |

## 项目结构

```
ai-cc-prod/
├── client/                    # 前端 — React + Vite
│   ├── src/
│   │   ├── api/               # API 请求封装
│   │   ├── pages/
│   │   │   ├── Guest/         # 游客 H5 页面
│   │   │   └── Staff/         # 店员后台页面
│   │   ├── components/        # 公共组件
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── .env                   # 前端环境变量
│   ├── vite.config.ts
│   └── package.json
├── server/                    # 后端 — Express API
│   ├── src/
│   │   ├── config/            # 配置（sku.template.json 主数据）
│   │   ├── db/                # 数据库连接与初始化
│   │   ├── routes/            # API 路由（orders / upload / print / sku）
│   │   ├── services/          # 业务逻辑（sku / inventory / bom）
│   │   └── index.ts           # 入口
│   ├── .env                   # 后端环境变量
│   ├── tsconfig.json
│   └── package.json
├── uploads/                   # 图片上传存储
├── data/                      # SQLite 数据库文件 + 独立迁移脚本 init.sql
├── .gitignore
├── package.json               # 根级统一脚本
└── README.md
```

## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9

### 安装依赖

```bash
# 方式1：统一安装
npm run install:all

# 方式2：分别安装
cd client && npm install
cd ../server && npm install
```

### 启动开发环境

```bash
# 方式1：一键启动前后端（推荐）
npm run dev

# 方式2：分别启动
# 终端1 — 后端
cd server && npm run dev

# 终端2 — 前端
cd client && npm run dev
```

- **前端**：http://localhost:5173
- **后端**：http://localhost:3001
- **健康检查**：http://localhost:3001/api/health

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3001 | 后端端口 |
| `NODE_ENV` | development | 运行环境 |
| `DB_PATH` | ../server/storage/prod.db | 数据库路径（data/ 目录被沙箱拦截写入，已迁移至 server/storage/prod.db） |
| `UPLOAD_PATH` | ../uploads | 上传目录 |
| `CLIENT_URL` | http://localhost:5173 | CORS 允许的前端地址 |

## 数据库

### orders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 内部主键 |
| `order_id` | TEXT UNIQUE | 订单编号 (UUID) |
| `customer_name` | TEXT | 客户名称 |
| `source` | TEXT | 订单来源 (offline/website/shopify/etsy/tiktok) |
| `store_id` | TEXT | 门店 ID（预留） |
| `master_sku` | TEXT | Master SKU（关联 sku.template.json 产品） |
| `channel_sku` | TEXT | Channel SKU（预留渠道映射） |
| `image_url` | TEXT | 原图路径 |
| `preview_url` | TEXT | 预览图路径 |
| `print_url` | TEXT | 打印文件路径 |
| `crop_data` | TEXT | Canvas 裁剪参数 (JSON) |
| `status` | TEXT | 订单状态 |
| `remark` | TEXT | 备注 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

### materials 表（Phase 1.5 — 物料库存主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `material_id` | TEXT PK | 物料编号（如 ACRYLIC_3MM） |
| `name` | TEXT | 物料名称 |
| `category` | TEXT | 物料分类 |
| `unit` | TEXT | 单位（pcs 等） |
| `current_stock` | INTEGER | 当前库存 |
| `safety_stock` | INTEGER | 安全库存（低于则预警） |

### bom_consumption_log 表（Phase 1.5 — BOM 扣减流水）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 流水主键 |
| `order_id` | TEXT | 关联订单 |
| `master_sku` | TEXT | 关联产品 SKU |
| `material_id` | TEXT | 扣减物料 |
| `qty` | INTEGER | 扣减数量 |
| `created_at` | TEXT | 扣减时间 |

### inventory_alerts 表（Phase 1.5 — 低库存预警）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 预警主键 |
| `material_id` | TEXT | 物料 |
| `material_name` | TEXT | 物料名称快照 |
| `remaining` | INTEGER | 扣减后剩余库存 |
| `safety_stock` | INTEGER | 安全库存阈值 |
| `created_at` | TEXT | 预警时间 |

### 订单状态

```
NEW → WAITING_CHECK → READY_PRINT → PRINTED → PROCESSING → COMPLETED
```

## 开发约定

1. **API 前缀**：所有后端接口以 `/api` 开头
2. **模块化**：按功能拆分 routes/services，保持单一职责
3. **扩展性**：数据库表预留 `master_sku`、`channel_sku`、`source` 等字段
4. **MVP 原则**：不提前开发未来功能，先完成最小可用闭环

## 当前进度

- [x] Phase 0 — 项目初始化 ✅
  - [x] Task 0.1: 项目目录结构
  - [x] Task 0.2: 前后端项目初始化
  - [x] Task 0.3: 基础运行环境配置
  - [x] Task 0.4: 数据库连接
  - [x] Task 0.5: README 运行说明
- [x] Phase 1 — MVP 开发
  - [x] Task 2: 订单数据库（含 4 位取件码，当日唯一、0 点重置）
  - [x] Task 3: 游客 H5 上传页面（选品 → 上传 → 预览 → 下单出取件码）
  - [x] Task 4: Canvas 图片处理（原生 Canvas 拖拽/缩放/cover 裁剪）
  - [x] Task 5: 店员后台（订单列表 + 取件码查询 + 状态筛选 Tab + 产品名显示）
  - [x] Task 6: 打印流程（前端导出高清打印图 → 上传后端保存 print_url → 查看）
- [x] Phase 1.5 — 产品主数据系统（Master SKU）
  - [x] 独立迁移脚本 `data/init.sql`（与 init.ts 字段一致，含物料种子 + 初始入库流水）
  - [x] `sku.template.json` 主数据配置（physicalSize / printArea / dpi / bleed / mirror / template / paper / bom）
  - [x] `sku.service.ts` 读取模板；前端产品改为由 `/api/skus` 驱动（带静态兜底）
  - [x] `materials` 物料表 + 初始库存 100 / 安全库存 20
  - [x] `bom.service.ts`（inventory.service）+ `bom_consumption_log` 扣减流水
  - [x] 订单置 `COMPLETED` 时触发 BOM 扣减（幂等），低于安全库存写 `inventory_alerts` 预警
  - [x] `inventory_transactions` 库存流水表（IN 入库 / OUT 出库扣减 / ADJUST 调整），支持「已使用数量」统计
  - [x] 新增接口：`GET /api/skus`、`/api/skus/:sku`、`/api/materials`、`GET /api/inventory/summary`（物料+可生产数量+预警）、`GET /api/inventory/alerts`、`POST /api/inventory/stock-in`（采购入库）
  - [x] **库存 / 预警 UI（店员后台「库存」Tab）**：物料库存卡片（当前/已使用/安全库存/状态）、各产品可生产数量、低库存预警横幅、采购入库表单
- [x] Task 6 升级 — 真实拼版打印（店员后台「拼版」Tab）
  - [x] 勾选多个可打印订单（READY_PRINT/PRINTED/...），按各自 SKU 物理尺寸在打印纸张上自动排版
  - [x] 支持纸张（A4/A5/6寸/5寸）、DPI（72/150/300）、边距/间距参数
  - [x] 原生 Canvas 拼版（cover 裁切 + 取件码标注），`@media print` 仅输出拼版纸张，浏览器直接打印
  - [x] **拼版增强**：每张图绘制「裁切实线」(物理尺寸边界) + 「出血虚线」(bleed 外扩)，bleed 取自 SKU `printSettings.bleed`
  - [x] **多页自动分页**：订单超出单页时自动分多张纸，打印时每页独立成张（`page-break-after: always`）
  - [x] **排版算法升级（任务 B）**：shelf 装箱 + 可选旋转（best-fit），按面积降序放置，比简单行优先更省纸；旋转开关默认关（产品方向固定，如钥匙扣不可旋转）
  - [x] **导出 PDF（任务 A）**：用纯前端 `jsPDF` 把拼版页导出为多页 PDF（带出血/裁切标记），替代浏览器打印对话框，无需 PDFKit 原生依赖
  - [x] **缺料拦截**：生成拼版前按所选订单 BOM 核算总需求，库存不足则拦截并列出缺料清单（提示先去库存页补货）
  - [x] **首页红点**：店员「库存」Tab 在存在低库存预警时显示数量徽标（来自 `GET /api/inventory/alerts`）
  - [x] 拼版导出 PDF 用纯前端 `jsPDF`（替代 Phase 3 计划的 PDFKit，无原生依赖）；Sharp 300DPI 出图仍属 Phase 3 未做
- [x] 部署（阶段 1 本地生产运行 + 阶段 3 Cloudflare 架构说明）

### Phase 1.5 说明（Master SKU 与 BOM）
- **产品主数据**：所有产品定义集中在 `server/src/config/sku.template.json`，加新品 = 加一条 product，不改代码；`bom` 数组声明所需物料及数量。
- **物料库存**：`materials` 表初始 4 种物料各 100，安全线 20；`init.ts` 种子与 `data/init.sql` 保持一致。
- **BOM 扣减**：店员将订单状态改为 `COMPLETED` 时，后端按该 SKU 的 `bom` 逐项扣减并写 `bom_consumption_log`（同时写 `inventory_transactions` 的 OUT 流水）；已扣减订单再次完成会被幂等跳过；扣减后跌破安全线自动生成 `inventory_alerts` 预警记录。
- **库存统计**：`inventory_transactions` 记录所有 IN/OUT 流水，「已使用数量」= 历史 OUT 之和；采购入库走 `POST /api/inventory/stock-in`，写 IN 流水并增加 `current_stock`。
- **前端驱动**：游客端产品列表改由 `GET /api/skus` 拉取（后端不可用时回退到 `products.ts` 静态兜底），店员端产品名映射仍走同一来源。
- **范围边界**：后端 Sharp 300DPI 出图属 Phase 3 / 后期，未做；拼版打印用前端原生 Canvas 实现，拼版导出 PDF 用纯前端 `jsPDF`（已完成，替代 PDFKit 原生依赖）；图片编辑器已用 `Konva.js`（纯 JS）重写。

### 打印流程说明（Task 6 + 拼版）
- **单张打印图**：店员在编辑页用 `ImageEditor`（Konva.js 渲染）调整好裁剪后，点击「生成打印图」→ 通过 `forwardRef` 暴露的 `exportPrintImage(scale=3)`，用 Konva Stage 高分辨率导出（约 1080px）PNG dataURL → `POST /api/orders/:orderId/print` 上传，后端存入 `uploads/` 并写入订单 `print_url`。生成后可点击「查看打印图」在新标签打开人工打印。
- **批量拼版打印**：店员切到「拼版」Tab → 勾选多个可打印订单 → 设置纸张/DPI/边距/间距（可选「允许旋转」省纸）→「生成拼版」按各自 SKU 物理尺寸(+出血)在纸张上自动排版（shelf 装箱 + 可选旋转，裁切实线 + 出血虚线 + 取件码标注）→ 可「打印」（浏览器打印，每页独立成张）或「导出 PDF」（jsPDF 多页 PDF）。订单超出单页时自动分页。生成前会核算 BOM 物料需求，库存不足则拦截并提示缺料。设计取舍：拼版渲染用前端原生 Canvas，PDF 导出用纯前端 `jsPDF`，均无需原生模块（避开 Windows 无 VS 编译 + 沙箱安全钩子的限制）。

## MVP 禁止开发内容

- ❌ AI 自动识别裁剪 (YOLO / Vision API)
- ❌ 静默打印 / 自动打印
- ❌ 电商平台 API (Shopify / Etsy / TikTok)
- ❌ 复杂权限系统
- ❌ Electron 桌面程序

## 部署

按路线指南，部署分三阶段。当前已实现**阶段 1 本地生产运行**，阶段 3 Cloudflare 仅提供架构说明（需账号与凭证，不在本仓库直接交付）。

### 阶段 1：本地 / 局域网生产运行

前后端同源部署：生产模式下 Express 直接托管前端构建产物（`client/dist`），无需单独起 Vite。

```bash
# 1. 安装依赖（首次）
npm run install:all

# 2. 构建前后端
npm run build            # = build:server (tsc) + build:client (tsc --noEmit && vite build)

# 3. 启动生产服务（NODE_ENV=production，Express 托管 dist + 提供 /api）
npm run start:prod       # = cd server && NODE_ENV=production node dist/index.js
```

- 访问：`http://localhost:3001`（游客与店员后台同源；店员后台 `#/staff`）
- 数据库：默认 `server/storage/prod.db`（SQLite），首次启动自动建表 + 物料种子
- 上传目录：默认 `uploads/`，生产环境同样由 Express 托管
- 重置数据：删除 `server/storage/prod.db`，重启即重新初始化（物料回到初始 100 / 安全 20）
- 自定义：可用环境变量 `PORT` / `DB_PATH` / `UPLOAD_PATH` 覆盖默认

> 说明：生产构建会清空并重建 `client/dist`。部分受限环境（如沙箱）的回收站/删除钩子会拦截 `dist` 清理，此时可在正常开发机上执行 `npm run build`，或构建到临时目录后拷贝产物。

### 阶段 3：Cloudflare 部署（架构说明，需凭证）

```
Cloudflare Pages  →  静态前端（client/dist）
Cloudflare Workers API  →  后端 API（需改造为 Workers 兼容，或自托管 Node 服务）
Cloudflare D1 / 外部 SQLite  →  数据库（当前用 better-sqlite3，需替换为 D1 或托管数据库）
Cloudflare R2  →  图片存储（当前 uploads/ 本地目录，需替换为 R2）
```

迁移到 Cloudflare 时需解决：① `better-sqlite3` 是原生模块，Workers 不支持，需改用 D1；② 图片上传需改用 R2；③ `sku.template.json` 主数据可保留（Workers 可读 KV/绑定）。本阶段不在当前 MVP 范围内，仅作路线预留。

### 当前阶段 1 验证

- 后端 `tsc --noEmit` 类型检查通过
- 前端 `tsc --noEmit` + `vite build` 构建通过（36 模块）
- `NODE_ENV=production node dist/index.js` 启动后：`GET /` 返回 200 HTML（SPA），未知路由 SPA 回退，`/api/*` 正常响应
