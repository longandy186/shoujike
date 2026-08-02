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
| 图片处理 | 原生 Canvas API（Fabric.js 在 Windows 下编译失败，改用原生实现） |
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
  - [x] 独立迁移脚本 `data/init.sql`（与 init.ts 字段一致，含物料种子）
  - [x] `sku.template.json` 主数据配置（physicalSize / printArea / dpi / bleed / mirror / template / paper / bom）
  - [x] `sku.service.ts` 读取模板；前端产品改为由 `/api/skus` 驱动（带静态兜底）
  - [x] `materials` 物料表 + 初始库存 100 / 安全库存 20
  - [x] `bom.service.ts`（inventory.service）+ `bom_consumption_log` 扣减流水
  - [x] 订单置 `COMPLETED` 时触发 BOM 扣减（幂等），低于安全库存写 `inventory_alerts` 预警
  - [x] 新增接口：`GET /api/skus`（启用产品）、`/api/skus/:sku`、`/api/materials`（库存列表）

### Phase 1.5 说明（Master SKU 与 BOM）
- **产品主数据**：所有产品定义集中在 `server/src/config/sku.template.json`，加新品 = 加一条 product，不改代码；`bom` 数组声明所需物料及数量。
- **物料库存**：`materials` 表初始 4 种物料各 100，安全线 20；`init.ts` 种子与 `data/init.sql` 保持一致。
- **BOM 扣减**：店员将订单状态改为 `COMPLETED` 时，后端按该 SKU 的 `bom` 逐项扣减并写 `bom_consumption_log`；已扣减订单再次完成会被幂等跳过；扣减后跌破安全线自动生成 `inventory_alerts` 预警记录。
- **前端驱动**：游客端产品列表改由 `GET /api/skus` 拉取（后端不可用时回退到 `products.ts` 静态兜底），店员端产品名映射仍走同一来源。
- **范围边界**：本阶段只做后台数据层，无库存 UI；后端 Sharp 300DPI 出图、Fabric.js 重构属 Phase 3 / 后期，未做。

### 打印流程说明（Task 6）
- 店员在编辑页调整好裁剪后，点击「生成打印图」
- 前端 `ImageEditor` 通过 `forwardRef` 暴露 `exportPrintImage(scale=3)`，在离屏 Canvas 按 3 倍分辨率渲染（约 1080px），输出 PNG dataURL
- 通过 `POST /api/orders/:orderId/print`（multipart）上传，后端存入 `uploads/` 并写入订单 `print_url`
- 生成后可点击「查看打印图」在新标签打开，人工打印
- 设计取舍：未引入 `canvas` 原生依赖（Windows 无 VS 编译环境 + 沙箱安全钩子拦截安装），改在前端浏览器 Canvas 完成渲染，更轻量且无需后端图形库

## MVP 禁止开发内容

- ❌ AI 自动识别裁剪 (YOLO / Vision API)
- ❌ 静默打印 / 自动打印
- ❌ 电商平台 API (Shopify / Etsy / TikTok)
- ❌ 复杂权限系统
- ❌ Electron 桌面程序
