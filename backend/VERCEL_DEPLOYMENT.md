# 后端 Vercel Serverless 部署指南

本文档说明后端如何改造为支持 Vercel Serverless 部署，以及新增的部署步骤、环境变量和已知限制。原有的 VPS/Docker/PM2 部署方式（见根目录 `README.md`）**继续可用，两种部署方式共享同一套代码**，业务逻辑完全一致。

## 一、改造内容概览

| 问题 | 原实现 | 改造后 |
|---|---|---|
| 进程模型 | `app.listen()` 长驻进程 | 拆分为 `src/app.ts`（路由/中间件，两种部署共用）+ `src/index.ts`（传统长驻入口）+ `api/index.ts`（Vercel 函数入口） |
| 数据库连接/表同步 | 启动时执行一次 | 封装进 `src/bootstrap.ts` 的 `ensureReady()`，惰性 + 按函数实例缓存，冷启动时执行一次，同实例后续请求直接复用 |
| 数据库连接池 | 固定较大连接池 | 按 `VERCEL` 环境变量自动区分：Serverless 下用小连接池（默认 `max=2`）+ 短空闲回收，避免多实例并发打满 MySQL 连接数上限；可用 `DB_POOL_MAX` / `DB_POOL_IDLE` 覆盖 |
| 媒体文件存储 | 本地磁盘 `public/uploads/` | **Cloudflare R2**（S3 兼容 API，通过环境变量配置）是唯一支持的持久存储；Serverless 下未配置 R2 会明确报错 |
| 大文件上传 | multipart 直传后端，最大 100MB | 新增预签名直传接口（`/api/upload/presign` + `/api/upload/confirm`，`/api/media` 同理），浏览器直接 PUT 到 R2，绕开 Vercel 函数请求体上限（见下方"已知限制"） |
| 豆瓣图片代理缓存 | 写本地磁盘 `public/uploads/douban-cache/` | 改为 HTTP `Cache-Control`（`public, s-maxage=86400`），交给浏览器 / Vercel 边缘 CDN 缓存 |
| R2 音乐歌单 | 外部音源插件和短期流地址 | 管理员上传音频到 R2，后端保存歌单顺序，浏览器直接播放公开 R2 URL |

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

### 3. 配置 R2 存储桶 CORS（浏览器直传必需）

预签名 URL 指向 R2 的 S3 API 域名，和前端站点不是同源。**后端的 `CLIENT_URL` / Express CORS 配置不能替代 R2 Bucket CORS。**

在 Cloudflare Dashboard → R2 → 对应 Bucket → **Settings → CORS Policy** 中，为实际允许上传的前端域名配置规则。将下面示例中的域名替换为你的生产域名；如需从特定 Vercel 预览域名上传，逐个显式加入该域名，生产环境不要使用 `*`：

```json
[
  {
    "AllowedOrigins": ["https://your-frontend.vercel.app", "https://www.yourdomain.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag", "cf-ray", "x-amz-request-id"],
    "MaxAgeSeconds": 3600
  }
]
```

`PUT` 失败时按阶段排查：

- **presign**：检查后端 R2 环境变量、管理员登录状态和文件类型/大小；
- **浏览器网络/CORS**：在 DevTools Network 中检查 PUT 预检；确认该前端的完整协议和域名出现在 R2 CORS `AllowedOrigins`；
- **PUT 403**：检查 Access Key/Secret、令牌是否具备目标 Bucket 的 Object Read & Write、系统时间、签名是否过期，以及请求 `Content-Type` 是否与签名一致；
- **confirm**：检查后端是否能 `HEAD` / 复制临时对象，及对象 MIME、大小是否符合上传意图。

### 4. 前端媒体域名

在**前端** Vercel 项目构建环境中设置 `NEXT_PUBLIC_MEDIA_ORIGIN=https://media.yourdomain.com`。它必须等于稳定的公开 R2 自定义域名，用于 Next Image 白名单；它不会影响直接 PUT 的 CORS，后者由上述 Bucket CORS 决定。


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

### 首次部署与数据库迁移

Vercel 生产请求默认不会执行 DDL。首次部署、模型新增和这次 R2 歌单迁移都必须在部署前对目标数据库受控执行：

```bash
cd backend
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... npm run db:sync
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... npm run music:migrate-r2
```

`music:migrate-r2` 默认只生成 `backups/music-plugin-migration-*.json` 清单，不会更改数据库。审核备份后才使用 `music:migrate-r2 -- --apply`：它会迁移可识别的 R2 音频、清理外部插件音乐数据并删除旧插件表/设置字段。执行前必须备份数据库。管理员账号仍需手动 seed：

```bash
# 在本地，指向线上数据库执行一次即可
cd backend
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... npm run db:seed
```

## 四、前端配套修改

在此之外，豆瓣快照迁移需要先执行：

```bash
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... npm run db:migrate-douban-cache
```

然后在 Vercel 环境变量中设置高强度 `CRON_SECRET`。`vercel.json` 中的每小时定时任务会以 `Authorization: Bearer $CRON_SECRET` 调用 `/api/douban/cron-sync`；若当前 Vercel 套餐不支持 Cron，请使用外部调度器以同一认证头调用该 endpoint。

前端 `next.config.ts` 已经通过 `rewrites()` 把 `/api/*` 代理到 `BACKEND_URL`（同源代理，避免了跨域 Cookie 问题），部署到 Vercel 时只需要：

1. 在前端 Vercel 项目的环境变量里，把 `BACKEND_URL` 改成新的后端 Vercel 部署域名（如 `https://your-backend.vercel.app`）。
2. `NEXT_PUBLIC_API_URL` 保持 `/api`（相对路径）即可，无需改动。

**大文件上传使用已接入的预签名直传流程**：前端的正常上传组件会按 `POST /api/media/presign → 浏览器直接 PUT 至 R2 → POST /api/media/confirm` 执行。浏览器不会把 JWT 发送给 R2，后端会在确认阶段验证临时对象的 MIME、大小和归属后再移动到公开媒体路径。

## 五、已知限制

1. **Vercel Serverless 函数请求体上限约 4.5MB（平台硬限制，无法通过配置提高）**。普通图片、音频、视频和文件上传已使用受控的预签名直传流程，不会经过 Vercel 的请求体：
   1. 浏览器携带 JWT 调用 `POST /api/media/presign`，后端创建有归属、过期时间、MIME 和大小限制的上传意图；
   2. 浏览器以签名时约定的 `Content-Type` 直接 `PUT` 文件至 R2 的临时 `staging/` 路径；
   3. 浏览器调用 `POST /api/media/confirm`，后端 `HEAD` 校验对象、复制到最终公开路径并登记媒体记录。

   请勿把普通前端媒体上传改回旧的 `/api/upload/presign` 或后端 multipart 直传路径；后者会重新受 Vercel 请求体限制。动态照片的服务器端拆分流程仍有其专用确认接口。

2. **限流是"尽力而为"的单实例内存限流**（`middleware/rateLimit.ts`），未跨函数实例共享状态。多个并发实例各自维护自己的计数器，理论上可绕过全局限流阈值。功能仍然有效，只是在高并发多实例场景下精确度不如单进程部署。如需严格的全局限流，可以后续接入 Upstash Redis 之类的共享存储，这属于新增能力，未包含在本次改造中。

3. **R2 背景音乐直接播放**：管理员在「R2 音乐歌单」中选择已确认上传的 `audio/*` 媒体记录。前端只接收公开 R2 URL 并交给浏览器 `<audio>` 播放，音频字节不经过 Vercel，也没有第三方音源、请求头、解析或代理要求。

4. **历史本地文件迁移需要在切换到 Vercel 前离线完成**。Vercel Serverless 没有持久本地磁盘；请通过受控的离线迁移工具将旧 `/uploads/` 或其他旧存储 URL 复制到 R2、验证对象后更新数据库引用。应用运行时不提供旧存储迁移接口。

## 六、两种部署方式如何共存

- `src/app.ts`：Express 路由 + 中间件，两种部署方式共用，业务逻辑的唯一实现。
- `src/bootstrap.ts`：数据库连接 + 表同步，两种部署方式共用。
- `src/index.ts`：传统长驻部署入口（`npm run build && npm start`，或 PM2/Docker），调用 `bootstrap` 后 `app.listen()`。
- `api/index.ts`：Vercel Serverless 函数入口，直接把 `app` 转发给 Vercel 的请求/响应对象，初始化逻辑已经作为中间件挂在 `app` 内部（见 `app.ts` 里 `ensureReady()` 的调用），无需重复处理。

## 七、常见问题

### TiDB/MySQL 首次建表报 `BLOB/TEXT/JSON column ... can't have a default value`

**原因**：TiDB/MySQL 不允许给 `TEXT`、`LONGTEXT`、`BLOB` 或部分 `JSON` 字段声明普通 SQL `DEFAULT` 值。项目已将这些字段的默认值移至应用创建记录时写入，因此新的 `sequelize.sync()` DDL 不会再为它们生成 `DEFAULT` 子句。

**首次部署恢复方式**：该错误会使对应的 `CREATE TABLE` 语句整体失败，不会留下半张表。部署修复后的代码后，先受控执行 `npm run db:sync`，再请求 `/api/health` 验证。**不要为这个首次建表错误删除已有业务表。**

如需先确认数据库状态，可在 TiDB SQL Console 执行：

```sql
SELECT TABLE_NAME
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY TABLE_NAME;

SHOW CREATE TABLE music_playlists;
SHOW CREATE TABLE music_tracks;
SHOW CREATE TABLE site_settings;
SHOW CREATE TABLE posts;
```

`sequelize.sync()` 仅适合创建缺失表，**不是生产迁移工具**。不要在 Vercel 请求链路中使用 `sequelize.sync({ alter: true })`。对于已经存在、且确实需要调整字段定义的数据库：先备份，先以 `SHOW CREATE TABLE` 确认实际列名和数据，再在维护窗口执行经过审核的手动 SQL 迁移；严禁为修复默认值盲目 `DROP TABLE` 或 `DROP DATABASE`。
### 部署后报错 `Please install mysql2 package manually`

**原因**：Sequelize 内部通过 `require('mysql2')` 动态加载数据库驱动。Vercel 给
Serverless 函数打包时使用的依赖追踪（Node File Trace）是基于静态分析的，对这种
嵌套在 `sequelize` 内部深层调用链里的动态 `require()` 经常识别不到，导致 `mysql2`
没有被打进部署包——`package.json` 里明明写了这个依赖，`npm install` 也确实装了，
但运行时的函数环境里就是没有这个包。

**已修复**：`src/config/database.ts` 现在显式 `import mysql2 from "mysql2"`，并通过
Sequelize 的 `dialectModule` 选项直接把这个模块传给 Sequelize，不再依赖它内部的
动态 `require()`。这样一来 Vercel 的静态追踪能在我们自己的源码里直接看到这行
`import`，一定会把 `mysql2` 打进部署包；同时 Sequelize 也不会再去尝试自己
require 一次，从根源上消除了这个问题。如果之后升级 Sequelize 大版本或改用其他
ORM，注意保留这个显式 import + `dialectModule` 的写法。

### 报错 `Error [ERR_REQUIRE_ESM] ... require() of ES Module .../uuid/...`

**原因**：`uuid` 包从某个大版本开始（14.x）彻底放弃了 CommonJS 支持，变成
纯 ESM 包（`package.json` 里 `"main": null`，只有 `"type": "module"`）。
本项目后端整体用 `"module": "commonjs"` 编译，`import ... from "uuid"` 会被
编译成 `require("uuid")`，用 CommonJS 的 `require()` 加载纯 ESM 包本来就不被
允许，跟 Vercel 没有直接关系，只是本地/PM2 环境可能因为 Node 版本较新（Node
22.12+/23+ 对同步加载 ESM 有实验性支持）或者没跑到相关代码路径而一直没暴露，
部署到 Vercel 的 Node 运行时后被真实触发了。

**已修复**：把 `package.json` 里的 `uuid` 版本从 `^14.0.1` 降到 `^11.1.1`——
这是最后一个同时提供 CommonJS 和 ESM 双构建的大版本（`exports` 字段里
`require` 条件指向 CJS 产物，`import` 条件指向 ESM 产物），API 用法
（`import { v4 as uuidv4 } from "uuid"`）完全不变，不影响任何业务逻辑。以后
升级依赖时，如果哪个包也做了"彻底放弃 CJS"这种大版本调整，思路一样：锁定在
它还支持 CJS 的最后一个大版本，或者干脆用 Node 自带的 `crypto.randomUUID()`
替代，从根源上避免第三方包的模块格式问题。


