# 后端 Vercel Serverless 部署指南

本文档说明后端如何改造为支持 Vercel Serverless 部署，以及新增的部署步骤、环境变量和已知限制。原有的 VPS/Docker/PM2 部署方式（见根目录 `README.md`）**继续可用，两种部署方式共享同一套代码**，业务逻辑完全一致。

## 一、改造内容概览

| 问题 | 原实现 | 改造后 |
|---|---|---|
| 进程模型 | `app.listen()` 长驻进程 | 拆分为 `src/app.ts`（路由/中间件，两种部署共用）+ `src/index.ts`（传统长驻入口）+ `api/index.ts`（Vercel 函数入口） |
| 数据库连接/表同步 | 启动时执行一次 | 封装进 `src/bootstrap.ts` 的 `ensureReady()`，惰性 + 按函数实例缓存，冷启动时执行一次，同实例后续请求直接复用 |
| 数据库连接池 | 固定较大连接池 | 按 `VERCEL` 环境变量自动区分：Serverless 下用小连接池（默认 `max=2`）+ 短空闲回收，避免多实例并发打满 MySQL 连接数上限；可用 `DB_POOL_MAX` / `DB_POOL_IDLE` 覆盖 |
| 媒体文件存储 | 又拍云 或 本地磁盘 `public/uploads/` | 新增 **Cloudflare R2**（S3 兼容 API，通过环境变量配置）作为首选存储；又拍云保留兼容；本地磁盘回退仅限非 Serverless 部署，Serverless 下配置不全会直接报错而不是静默写坏文件 |
| 大文件上传 | multipart 直传后端，最大 100MB | 新增预签名直传接口（`/api/upload/presign` + `/api/upload/confirm`，`/api/media` 同理），浏览器直接 PUT 到 R2，绕开 Vercel 函数请求体上限（见下方"已知限制"） |
| 豆瓣图片代理缓存 | 写本地磁盘 `public/uploads/douban-cache/` | 改为 HTTP `Cache-Control`（`public, s-maxage=86400`），交给浏览器 / Vercel 边缘 CDN 缓存 |
| 音源插件（MusicFree）存储 | `backend/plugins/*.js` 本地文件 + `fs.watch` 热重载 | 迁移到数据库 `music_sources` 表的 `code` 字段；内存缓存 + 60 秒 TTL 对账（`ensurePluginsFresh`），替代 `fs.watch` |

**原因**：Vercel Serverless 函数的文件系统只读且不持久（`/tmp` 除外，且各函数实例互不共享内存/磁盘），因此任何"写本地文件后续还要读到"的逻辑都必须迁移到数据库或对象存储。

## 二、部署前准备

### 1. 一个可从公网访问的 MySQL 数据库

Vercel 函数运行在 Vercel 的机房，无法访问你 VPS 内网里的 MySQL。可选：

- **PlanetScale**、**TiDB Serverless**、**Aiven for MySQL** 等 Serverless/托管 MySQL（推荐，原生适配大量短连接的场景）
- 云厂商 RDS（阿里云/腾讯云等）开启外网访问 + 白名单
- 自建 MySQL 开放公网端口（不推荐，需自行做好安全加固）

> Serverless 场景下同一时刻可能有多个函数实例并发运行，每个实例都有自己的小连接池；如果数据库的 `max_connections` 较小（默认常见值 151），高并发下仍可能被打满。如遇到连接数问题，优先选择原生支持大量连接/连接池代理的托管数据库，而不是继续调小 `DB_POOL_MAX`。

### 2. Cloudflare R2 存储桶

1. 登录 Cloudflare Dashboard → R2 → 创建 Bucket。
2. 在 Bucket 设置里绑定一个自定义公开访问域名（或先用开发用的 `xxx.r2.dev` 域名验证）。
3. R2 → 管理 API 令牌 → 创建 API 令牌，权限选择 **对象读写**（Object Read & Write），记录 Access Key ID / Secret Access Key。
4. 记录你的 Cloudflare 账户 ID（Account ID，在 Dashboard 右侧栏可见）。

## 三、Vercel 项目配置

后端建议作为**独立的 Vercel 项目**部署（与前端项目分开），Root Directory 设置为 `backend`。

### 环境变量（Vercel 项目设置 → Environment Variables）

```
NODE_ENV=production

# 数据库
DB_HOST=<你的数据库地址>
DB_PORT=3306
DB_USER=<用户名>
DB_PASSWORD=<密码>
DB_NAME=moment_blog
DB_SSL=true                 # 大多数托管 MySQL 需要，按数据库要求决定

# JWT
JWT_SECRET=<32+ 位随机字符串>
JWT_EXPIRES_IN=7d

# 前端域名（CORS，多个域名用逗号分隔，如生产域名 + Vercel 预览域名）
CLIENT_URL=https://your-frontend.vercel.app

REVALIDATE_SECRET=<与前端一致>

# R2 存储
R2_ACCOUNT_ID=<Cloudflare 账户 ID>
R2_ACCESS_KEY_ID=<R2 API Token Access Key>
R2_SECRET_ACCESS_KEY=<R2 API Token Secret Key>
R2_BUCKET=<Bucket 名称>
R2_PUBLIC_URL=https://media.yourdomain.com   # Bucket 绑定的公开访问域名
```

`VERCEL=1` 由 Vercel 平台自动注入，不需要手动配置。

### 项目设置

- Framework Preset：选 **Other**（本项目已附带 `vercel.json`，无需手动配置 Build/Output）
- `vercel.json` 已设置：所有请求 rewrite 到 `api/index.ts`；函数 `maxDuration: 30`（Hobby 计划可能有更低上限，可按你的套餐调整）

### 首次部署后：初始化数据库

数据库表结构由 `ensureReady()` 在首次请求时自动通过 `sequelize.sync()` 创建（只建表，不改已存在表的结构）。**管理员账号需要手动 seed 一次**（和 VPS 部署一样）：

```bash
# 在本地，指向线上数据库执行一次即可
cd backend
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... npm run db:seed
```

## 四、前端配套修改

前端 `next.config.ts` 已经通过 `rewrites()` 把 `/api/*` 代理到 `BACKEND_URL`（同源代理，避免了跨域 Cookie 问题），部署到 Vercel 时只需要：

1. 在前端 Vercel 项目的环境变量里，把 `BACKEND_URL` 改成新的后端 Vercel 部署域名（如 `https://your-backend.vercel.app`）。
2. `NEXT_PUBLIC_API_URL` 保持 `/api`（相对路径）即可，无需改动。

**大文件上传需要前端适配预签名直传接口**（见下方"已知限制"第 1 条）——这部分不在本次后端改造范围内，如需要我可以继续帮你更新前端上传逻辑。

## 五、已知限制

1. **Vercel Serverless 函数请求体上限约 4.5MB（平台硬限制，无法通过配置提高）**。原有的"直接把文件 POST 到后端"上传方式（`/api/upload/video`、`/api/upload/motion-photo`、`/api/media/upload` 等）只对小文件有效；视频（原限制 100MB）、动态照片（原限制 60MB）等大文件**必须**改走新增的预签名直传流程：
   - `POST /api/upload/presign`（或 `/api/media/presign`）拿到 `uploadUrl` + `key`
   - 浏览器 `fetch(uploadUrl, { method: "PUT", body: file })` 直接传给 R2
   - `POST /api/upload/confirm`（或 `/api/media/confirm`）登记媒体记录
   - 动态照片专用 `POST /api/upload/motion-photo/confirm`（`{ key, filename }`），由后端拉回文件做图片/视频拆分
   这几个接口已经在后端实现好了，**前端调用逻辑目前还是走旧的直传方式**，超过约 4MB 的文件在 Vercel 上会先被平台拒绝（413），需要更新前端上传组件改走这条新路径才能完整生效。

2. **限流是"尽力而为"的单实例内存限流**（`middleware/rateLimit.ts`），未跨函数实例共享状态。多个并发实例各自维护自己的计数器，理论上可绕过全局限流阈值。功能仍然有效，只是在高并发多实例场景下精确度不如单进程部署。如需严格的全局限流，可以后续接入 Upstash Redis 之类的共享存储，这属于新增能力，未包含在本次改造中。

3. **插件（音源）安装/删除后，跨函数实例的可见延迟最长约 60 秒**（`music-sources/mf-manager.ts` 的 `SYNC_TTL_MS`）。发起安装/删除请求的那次调用本身立即生效；但其它已经在运行的"热"函数实例要等到自己的 60 秒 TTL 到期重新对账数据库才会感知到变化。可以按需调小该常量换取更低延迟（代价是更频繁的数据库查询）。

4. **"迁移本地文件到又拍云"（`/api/upload/migrate-to-upyun`）和"扫描本地文件导入媒体库"（`/api/media/import`）这两个管理员工具只对传统 VPS/Docker 部署有意义**——它们扫描的是本地磁盘 `public/uploads/` 目录。Vercel Serverless 部署下没有这个目录（本来也不会有本地文件需要迁移），调用会直接返回空结果，不会报错。

5. **冷启动延迟**：长时间没有请求时，Vercel 会回收空闲的函数实例；下一次请求需要重新建立数据库连接、同步表结构、加载插件，会比热请求慢。这是 Serverless 架构的正常特性，可以通过 Vercel 的付费计划开启的一些保活/预热机制缓解，本次改造未做特殊处理。

## 六、两种部署方式如何共存

- `src/app.ts`：Express 路由 + 中间件，两种部署方式共用，业务逻辑的唯一实现。
- `src/bootstrap.ts`：数据库连接 + 表同步 + 插件预热，两种部署方式共用。
- `src/index.ts`：传统长驻部署入口（`npm run build && npm start`，或 PM2/Docker），调用 `bootstrap` 后 `app.listen()`。
- `api/index.ts`：Vercel Serverless 函数入口，直接把 `app` 转发给 Vercel 的请求/响应对象，初始化逻辑已经作为中间件挂在 `app` 内部（见 `app.ts` 里 `ensureReady()` 的调用），无需重复处理。

修改业务逻辑（路由、中间件、models、services）时，两种部署方式会同时生效，不需要分别维护。
