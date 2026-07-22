**thanks for [Linux Do](https://linux.do)**

# kanle · 朋友圈博客

一个微信朋友圈风格的个人博客系统，支持动态、文章、评论互动、媒体上传、R2 音乐歌单、豆瓣影单、RSS 与后台管理。

推荐使用 **Vercel（前后端分离）+ TiDB Cloud / 托管 MySQL + Cloudflare R2** 部署，无需维护自己的应用服务器；也保留 VPS + PM2 + Nginx 自托管方案。

> 本文所有域名、数据库地址、账号和密钥均为占位示例。请使用自己的真实配置，且**绝不要提交 `.env`、数据库密码、R2 Access Key、JWT 密钥或其他 Token 到仓库**。

## 功能特性

- **朋友圈动态**：图文、多图拼图、视频、Live Photo、音乐、链接卡片、豆瓣卡片与地理位置；
- **文章系统**：富文本编辑、封面、标签、目录、归档时间线；
- **评论互动**：楼层评论、回复折叠、表情、点赞、邮件通知；
- **媒体与音乐**：媒体直传 Cloudflare R2，R2 音频歌单、LRC 歌词、浮窗播放器；
- **豆瓣影单**：同步电影、图书和音乐收藏，支持筛选与分页；
- **后台管理**：动态、文章、评论、媒体、友链、广告、音乐、黑名单、SMTP、高德地图、豆瓣、RSS 与站点设置；
- **体验与 SEO**：响应式布局、夜间模式、RSS Feed、SSR 与 OG 标签。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 前端 | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand |
| 后端 | Express 5 · Sequelize 6 · TypeScript 6 |
| 数据库 | MySQL 兼容数据库；推荐 TiDB Cloud 等托管服务 |
| 媒体存储 | Cloudflare R2（生产环境持久媒体存储） |
| 推荐部署 | Vercel 前端 + Vercel 后端 + 托管 MySQL/TiDB + R2 |
| 可选自托管 | PM2 + Nginx + MySQL |

## 代码仓库

| 版本 | GitHub | Gitee |
| --- | --- | --- |
| 稳定版（推荐） | `https://github.com/zilinnb/kanle.git` | `https://gitee.com/ziln_cn/kanle.git` |
| 开发版 | — | `https://gitee.com/ziln_cn/kanle-next.git` |

---

# 推荐部署：Vercel + TiDB/托管 MySQL + Cloudflare R2

该方案将前端、后端作为两个独立的 Vercel 项目部署：

```text
浏览器
  │
  ▼
Vercel 前端（frontend）
  │  浏览器访问 /api/*；Next.js 在服务端转发请求
  ▼
Vercel 后端（backend）
  ├──► TiDB Cloud / 托管 MySQL（业务数据）
  └──► Cloudflare R2（图片、视频、音频等媒体）
```

建议准备三个稳定的 Origin：

| 用途 | 示例 | 说明 |
| --- | --- | --- |
| 前端站点 | `https://example.com` | 用户实际访问的网站 |
| 后端 API | `https://api.example.com` | 后端 Vercel 项目地址；也可先使用 Vercel 的稳定 Production 域名 |
| R2 媒体域名 | `https://media.example.com` | 绑定到 R2 Bucket 的公开自定义域名 |

不要将每次构建产生的 Vercel Preview URL 当作长期配置。Preview URL 可能变化，会导致 CORS、R2 上传和回调配置失效。

## 1. 前置条件

- GitHub 或 Gitee 仓库；
- Vercel 账号；
- TiDB Cloud 或其他可公网连接的 MySQL 兼容数据库；
- Cloudflare 账号与 R2 Bucket；
- Node.js 20+ 与 pnpm（用于本地初始化目标数据库）；
- 可选：已托管到 Cloudflare 的域名，用于 R2 媒体自定义域名。

## 2. 创建数据库并初始化

### 2.1 创建 TiDB / MySQL 数据库

在 TiDB Cloud SQL Editor、云数据库控制台或 MySQL 客户端中创建数据库，例如：

```sql
CREATE DATABASE moment_blog
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

记录数据库服务提供的以下信息：

```text
Host
Port
Username
Password
Database name
是否要求 SSL/TLS
```

TiDB Cloud 等托管服务通常要求 TLS；请以控制台的 Connect 页面为准。常见配置为：

```env
DB_SSL=true
```

> `db:init` 只初始化一个**已经存在**的数据库，不会执行 `CREATE DATABASE`。如果报 `Unknown database`，请先完成本步骤。

### 2.2 在本地初始化目标数据库

下载源码后，在本地进入后端目录：

```bash
cd backend
pnpm install
```

复制环境变量模板：

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
# Copy-Item .env.example .env
```

编辑 `backend/.env`，让它指向目标数据库。以下仅为示例：

```env
DB_HOST=<your-database-host>
DB_PORT=<your-database-port>
DB_USER=<your-database-user>
DB_PASSWORD=<your-database-password>
DB_NAME=moment_blog
DB_SSL=true

# 仅在首次尚无管理员时用于创建管理员
ADMIN_EMAIL=admin@example.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<choose-a-strong-password>
```

执行唯一的官方数据库初始化命令：

```bash
pnpm db:init
```

`db:init` 会：

1. 验证数据库连接；
2. 创建缺失的项目数据表；
3. 补齐当前支持的兼容字段；
4. 创建缺失的站点设置记录；
5. 创建默认音乐歌单；
6. 首次不存在管理员时创建管理员。

该命令可安全重复运行：不会删除业务数据，不会重置已有管理员密码，也不会在已有数据上使用 `alter` 或 `force`。

> 正式部署请在本地、CI 或受信任的维护环境中显式运行 `pnpm db:init`。应用启动及 Vercel 冷启动默认只连接数据库，**不会自动执行 DDL**。不要将 `DB_SYNC_ON_BOOT=true` 作为常规生产部署方案。

## 3. 配置 Cloudflare R2

Vercel Serverless 的文件系统不持久。生产环境的图片、视频、音频等媒体必须使用 R2 等对象存储保存。

### 3.1 创建 Bucket 与 API Token

1. 在 Cloudflare Dashboard 中进入 **R2 → Create bucket**；
2. 创建 Bucket，例如 `moment-media`；
3. 进入 **R2 → Manage R2 API Tokens**；
4. 创建具备 **Object Read & Write** 权限的 API Token；
5. 保存以下信息，稍后只填入后端环境变量：

```text
Cloudflare Account ID
Access Key ID
Secret Access Key
Bucket 名称
```

### 3.2 绑定公开媒体域名

在 Bucket 设置中绑定一个稳定的公开自定义域名，例如：

```text
https://media.example.com
```

该域名必须同时用于：

```text
后端 R2_PUBLIC_URL
前端 NEXT_PUBLIC_MEDIA_ORIGIN
```

两者必须完全相同，且不要带末尾 `/`：

```text
正确：https://media.example.com
错误：https://media.example.com/
```

### 3.3 配置 R2 CORS

浏览器上传媒体时，会通过后端签发的预签名 URL 直接 `PUT` 到 R2。R2 Bucket 需要独立配置 CORS；后端的 `CLIENT_URL` 或 `CORS_ALLOWED_ORIGINS` 不能替代它。

在 **R2 → Bucket → Settings → CORS Policy** 中配置。生产模板如下：

```json
[
  {
    "AllowedOrigins": [
      "https://example.com",
      "https://www.example.com"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag", "cf-ray", "x-amz-request-id"],
    "MaxAgeSeconds": 3600
  }
]
```

本地开发时，可额外加入：

```text
http://localhost:3000
```

注意：

- `AllowedOrigins` 应填写**浏览器中打开前端页面的完整 Origin**；
- 不要将 API 域名或 R2 媒体域名填进去，除非页面确实从该 Origin 提供；
- 如果使用前端 Vercel Production 域名测试，也要把它加入；
- 生产环境不要使用 `"AllowedOrigins": ["*"]`。

## 4. 部署后端 Vercel 项目

在 Vercel 中导入仓库并创建第一个项目：

| 设置项 | 值 |
| --- | --- |
| Root Directory | `backend` |
| Framework Preset | `Other` |
| Build / Output 设置 | 使用项目默认配置即可 |

项目内已有 `backend/vercel.json`，它会配置 Serverless Function 重写和豆瓣同步 Cron。Vercel 会自动注入 `VERCEL=1`，无需手动设置。

在 **Settings → Environment Variables** 中配置 Production 环境变量。

### 后端运行时环境变量

| 变量 | 是否需要 | 示例 / 说明 |
| --- | --- | --- |
| `NODE_ENV` | 是 | `production` |
| `DB_HOST` | 是 | `<your-database-host>` |
| `DB_PORT` | 是 | 使用数据库控制台提供的端口；不要假定一定是 `3306` |
| `DB_USER` | 是 | 数据库用户名 |
| `DB_PASSWORD` | 是 | 数据库密码 |
| `DB_NAME` | 是 | 例如 `moment_blog` |
| `DB_SSL` | 托管数据库通常需要 | 通常为 `true` |
| `DB_SSL_REJECT_UNAUTHORIZED` | 可选 | 只有数据库服务商明确要求时才设为 `false` |
| `JWT_SECRET` | 是 | 独立的 32+ 位随机字符串 |
| `JWT_EXPIRES_IN` | 否 | 默认 `7d` |
| `CLIENT_URL` | 是 | 前端稳定 Origin，如 `https://example.com` |
| `CORS_ALLOWED_ORIGINS` | 可选 | 多个稳定 Origin 用逗号分隔；设置后优先于 `CLIENT_URL` |
| `REVALIDATE_SECRET` | 是 | 必须与前端同名变量完全一致 |
| `FRONTEND_REVALIDATE_URL` | 可选 | 不填时回退到 `CLIENT_URL` |
| `CRON_SECRET` | 推荐 | 保护豆瓣 Cron 接口的独立随机字符串，仅后端使用 |
| `R2_ACCOUNT_ID` | 是 | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | 是 | R2 Object Read & Write Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 是 | 对应 Secret Access Key |
| `R2_BUCKET` | 是 | Bucket 名称 |
| `R2_PUBLIC_URL` | 是 | 公开媒体 Origin，如 `https://media.example.com` |
| `DB_POOL_MAX` | 可选 | Serverless 连接池上限；默认已针对 Vercel 调小 |
| `DB_POOL_IDLE` | 可选 | 连接池空闲回收时间（毫秒） |

后端配置示例：

```env
NODE_ENV=production

DB_HOST=<your-database-host>
DB_PORT=<your-database-port>
DB_USER=<your-database-user>
DB_PASSWORD=<your-database-password>
DB_NAME=moment_blog
DB_SSL=true

JWT_SECRET=<a-random-secret-at-least-32-characters>
JWT_EXPIRES_IN=7d

CLIENT_URL=https://example.com
REVALIDATE_SECRET=<another-random-secret>
CRON_SECRET=<another-independent-random-secret>

R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<your-r2-secret-access-key>
R2_BUCKET=moment-media
R2_PUBLIC_URL=https://media.example.com
```

`JWT_SECRET`、`REVALIDATE_SECRET` 与 `CRON_SECRET` 应使用彼此不同的随机值。

> `ADMIN_EMAIL`、`ADMIN_USERNAME`、`ADMIN_PASSWORD` 只在本地首次运行 `db:init` 且数据库中尚无管理员时使用。数据库初始化完成后，它们不是 Vercel 后端运行时必填变量。

## 5. 部署前端 Vercel 项目

再次从同一仓库创建第二个 Vercel 项目：

| 设置项 | 值 |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | `Next.js` |

在前端项目的 **Settings → Environment Variables** 中配置：

| 变量 | 是否需要 | 示例 / 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | 是 | 固定为 `/api` |
| `BACKEND_URL` | 是 | 后端 Origin，例如 `https://api.example.com`；不要加 `/api` 或结尾 `/` |
| `NEXT_PUBLIC_SITE_URL` | 推荐 | 前端公开站点 Origin，例如 `https://example.com` |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | 是 | 必须等于后端 `R2_PUBLIC_URL` |
| `REVALIDATE_SECRET` | 是 | 必须等于后端 `REVALIDATE_SECRET` |

示例：

```env
NEXT_PUBLIC_API_URL=/api
BACKEND_URL=https://api.example.com
NEXT_PUBLIC_SITE_URL=https://example.com
NEXT_PUBLIC_MEDIA_ORIGIN=https://media.example.com
REVALIDATE_SECRET=<the-same-value-as-backend>
```

以下关系必须成立：

```text
frontend.REVALIDATE_SECRET = backend.REVALIDATE_SECRET
frontend.NEXT_PUBLIC_MEDIA_ORIGIN = backend.R2_PUBLIC_URL
```

不要使用以下变量保存密钥：

```env
NEXT_PUBLIC_REVALIDATE_SECRET
NEXT_PUBLIC_CRON_SECRET
```

任何 `NEXT_PUBLIC_` 前缀变量都会在前端构建时暴露给浏览器。

### 为什么 `NEXT_PUBLIC_API_URL` 必须保持 `/api`

浏览器请求：

```text
https://example.com/api/posts
```

Next.js 通过 `BACKEND_URL` 在服务端转发到：

```text
https://api.example.com/api/posts
```

因此不要将 `NEXT_PUBLIC_API_URL` 写成完整后端地址。保持 `/api` 可减少浏览器跨域 Cookie 问题；域名变化时也不需要重写客户端 API 路径。

## 6. 绑定域名、Preview 与重新部署

建议将稳定 Production 域名绑定到 Vercel：

```text
前端：https://example.com
后端：https://api.example.com
R2：https://media.example.com
```

绑定完成后，重新检查：

```env
# frontend
BACKEND_URL=https://api.example.com
NEXT_PUBLIC_SITE_URL=https://example.com
NEXT_PUBLIC_MEDIA_ORIGIN=https://media.example.com

# backend
CLIENT_URL=https://example.com
R2_PUBLIC_URL=https://media.example.com
```

修改环境变量后，请分别对前端和后端项目执行一次 **Redeploy**。

特别注意：`NEXT_PUBLIC_MEDIA_ORIGIN` 会在前端构建期用于 Next Image 远程域名白名单。更换 R2 媒体域名后，必须重新构建前端。

如果测试 Vercel Preview 部署：

1. 使用稳定的 Preview 域名，或记录实际 Preview 的完整 Origin；
2. 将该 Origin 加入后端 `CORS_ALLOWED_ORIGINS`；
3. 同时将其加入 R2 Bucket 的 `AllowedOrigins`；
4. 不要长期依赖随分支变化的 Preview 地址作为生产配置。

## 7. 部署完成后的检查

1. 访问后端健康检查：

   ```text
   https://api.example.com/api/health
   ```

   预期返回：

   ```json
   { "status": "ok", "timestamp": "..." }
   ```

2. 打开前端站点，确认 Network 面板中请求路径为：

   ```text
   /api/posts
   /api/settings
   /api/friends
   ```

3. 使用 `db:init` 创建的管理员账号登录：

   ```text
   https://example.com/admin/login
   ```

4. 上传一张测试图片或音频：确认对象上传到 R2，且可通过 `R2_PUBLIC_URL` 对应的媒体域名访问；
5. 发布一条测试动态，确认列表刷新和页面重验证正常；
6. 如启用了豆瓣影单，确认后端已配置 `CRON_SECRET`，并检查 Vercel 套餐是否支持 Cron Jobs。

---

# 可选：VPS + PM2 + Nginx 自托管

如果希望自行维护服务器、MySQL、Nginx、SSL 与进程守护，可以使用以下方案。新部署优先推荐前面的 Vercel 方案；VPS 模式适合需要固定出口 IP、局域网数据库或完整服务器控制权的场景。

## 前置条件

- Debian 12 服务器（root 或 sudo 权限）；
- 一个域名（推荐）；
- 云服务商安全组已放行 `80`、`443` 与 `22` 端口；
- 已准备 Cloudflare R2，作为持久媒体存储。

## 1. 安装系统依赖、Node.js 与 PM2

```bash
apt update && apt upgrade -y
apt install -y curl wget git vim build-essential nginx mysql-server

# 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 启用 pnpm 并安装 PM2
corepack enable
corepack prepare pnpm@latest --activate
npm install -g pm2
```

验证：

```bash
node -v
pnpm -v
pm2 -v
```

## 2. 创建本地 MySQL 数据库

```bash
systemctl enable --now mysql
mysql -u root -p
```

在 MySQL 中执行：

```sql
CREATE DATABASE moment_blog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kanle'@'localhost' IDENTIFIED BY '<choose-a-strong-password>';
GRANT ALL PRIVILEGES ON moment_blog.* TO 'kanle'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 3. 克隆并部署后端

```bash
INSTALL_DIR=/opt/kanle

# 国内服务器可使用 Gitee
# git clone https://gitee.com/ziln_cn/kanle.git $INSTALL_DIR

git clone https://github.com/zilinnb/kanle.git $INSTALL_DIR
cd $INSTALL_DIR/backend
pnpm install
cp .env.example .env
```

编辑 `.env`。至少设置数据库、JWT、前端 Origin、重验证密钥及完整 R2 配置：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=kanle
DB_PASSWORD=<your-database-password>
DB_NAME=moment_blog

JWT_SECRET=<a-random-secret-at-least-32-characters>
CLIENT_URL=https://example.com
REVALIDATE_SECRET=<another-random-secret>

R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<your-r2-secret-access-key>
R2_BUCKET=moment-media
R2_PUBLIC_URL=https://media.example.com
```

构建、初始化并启动：

```bash
pnpm build
pnpm db:init
pm2 start ecosystem.config.js
pm2 save
```

检查：

```bash
curl http://127.0.0.1:4000/api/health
```

## 4. 部署前端

```bash
cd $INSTALL_DIR/frontend
pnpm install
cp .env.example .env.local
```

配置 `frontend/.env.local`：

```env
NEXT_PUBLIC_API_URL=/api
BACKEND_URL=http://127.0.0.1:4000
NEXT_PUBLIC_SITE_URL=https://example.com
NEXT_PUBLIC_MEDIA_ORIGIN=https://media.example.com
REVALIDATE_SECRET=<the-same-value-as-backend>

PORT=3000
HOSTNAME=0.0.0.0
```

构建并启动：

```bash
pnpm build
cp -r .next/static .next/standalone/.next/static
pm2 start ecosystem.config.js
pm2 save
```

检查：

```bash
curl http://127.0.0.1:3000
```

## 5. 配置 Nginx 与 HTTPS

复制并编辑项目提供的配置：

```bash
cp $INSTALL_DIR/deploy/nginx.conf /etc/nginx/conf.d/kanle.conf
vim /etc/nginx/conf.d/kanle.conf
```

将其中的：

```text
server_name yourdomain.com
/opt/kanle
```

分别替换为实际域名与安装目录。然后验证并重载：

```bash
nginx -t
nginx -s reload
```

安装证书工具并申请 HTTPS 证书：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d example.com
certbot renew --dry-run
```

设置防火墙与 PM2 开机启动：

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

pm2 startup
# 按提示执行输出的命令
pm2 save
```

---

# 环境变量参考

## 后端运行时变量

| 变量 | 必填 | 默认 / 说明 |
| --- | --- | --- |
| `NODE_ENV` | 生产建议设置 | `production` |
| `DB_HOST` | 是 | 数据库地址；本地常为 `127.0.0.1` |
| `DB_PORT` | 否 | 默认 `3306`；托管数据库按控制台给出的端口填写 |
| `DB_USER` | 是 | 数据库用户名 |
| `DB_PASSWORD` | 是 | 数据库密码 |
| `DB_NAME` | 否 | 默认 `moment_blog` |
| `DB_SSL` | 托管数据库通常需要 | 通常设为 `true` |
| `DB_SSL_REJECT_UNAUTHORIZED` | 可选 | 仅按数据库服务商要求设置 |
| `DB_POOL_MAX` | 可选 | 连接池最大连接数；Serverless 有较小默认值 |
| `DB_POOL_IDLE` | 可选 | 连接池空闲回收时间（毫秒） |
| `JWT_SECRET` | 是 | 至少 32 位的随机密钥 |
| `JWT_EXPIRES_IN` | 否 | 默认 `7d` |
| `CLIENT_URL` | 是 | 前端 Origin；多个前端可用逗号分隔 |
| `CORS_ALLOWED_ORIGINS` | 可选 | 显式 CORS 白名单，优先于 `CLIENT_URL` |
| `REVALIDATE_SECRET` | 是 | 与前端保持一致 |
| `FRONTEND_REVALIDATE_URL` | 可选 | 不填时使用 `CLIENT_URL` |
| `CRON_SECRET` | 使用 Vercel Cron 时需要 | 豆瓣 Cron Bearer 密钥，仅后端使用 |
| `R2_ACCOUNT_ID` | 生产媒体需要 | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | 生产媒体需要 | R2 Object Read & Write Key ID |
| `R2_SECRET_ACCESS_KEY` | 生产媒体需要 | 对应 Secret Key |
| `R2_BUCKET` | 生产媒体需要 | R2 Bucket 名称 |
| `R2_PUBLIC_URL` | 生产媒体需要 | 稳定的公开 R2 媒体 Origin |

## 仅首次初始化管理员时使用

| 变量 | 说明 |
| --- | --- |
| `ADMIN_EMAIL` | 当数据库没有管理员时，创建首个管理员的邮箱 |
| `ADMIN_USERNAME` | 首个管理员用户名，默认 `admin` |
| `ADMIN_PASSWORD` | 首个管理员密码；生产环境必须设置强密码 |

这些值由 `pnpm db:init` 使用。已有管理员后，再修改这些值不会重置已有账号密码。

## 前端变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | 是 | 保持 `/api`，由 Next.js rewrite 同源代理 |
| `BACKEND_URL` | 是 | 后端 Origin，不带 `/api`、不带尾随 `/` |
| `NEXT_PUBLIC_SITE_URL` | 推荐 | 前端公开 Origin |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | 是 | 必须等于后端 `R2_PUBLIC_URL`；更改后需重新构建前端 |
| `REVALIDATE_SECRET` | 是 | 与后端同名变量完全一致；没有 `NEXT_PUBLIC_` 前缀 |

---

# 升级与维护

## Vercel / Serverless 升级

1. 在部署前备份数据库；
2. 更新仓库代码；
3. 如版本说明提及模型或兼容字段更新，在受信任维护环境中让 `.env` 指向目标数据库后运行：

   ```bash
   cd backend
   pnpm install
   pnpm db:init
   ```

4. 在 Vercel 重新部署前端与后端项目；
5. 检查健康接口、登录和媒体上传。

`db:init` 不执行历史业务数据迁移、R2 音乐迁移或点赞重置。此类脚本必须按对应版本说明操作，并在执行前备份数据库；不要将它们作为首次安装步骤。

## VPS 升级

```bash
cd $INSTALL_DIR
git pull

cd backend
pnpm install
pnpm build
pnpm db:init
pm2 restart kanle-backend

cd ../frontend
pnpm install
pnpm build
cp -r .next/static .next/standalone/.next/static
pm2 restart kanle-frontend
```

---

# 后台配置

登录 `/admin` 后可以配置：

| 功能 | 位置 | 说明 |
| --- | --- | --- |
| SMTP 邮件 | 站点设置 → 邮件配置 | SMTP 服务器、端口、发件箱与测试邮件 |
| Cloudflare R2 | 云端存储 | R2 凭证由后端运行环境变量提供，浏览器使用预签名地址直传 |
| 高德地图 | 站点设置 → 高德地图配置 | Web 端 JS API Key、Web 服务 Key 与安全密钥 |
| R2 音乐歌单 | R2 音乐歌单 | 选择已上传到 R2 的音频，调整播放顺序 |
| 豆瓣影单 | 站点设置 → 豆瓣配置 | 豆瓣 ID 与同步设置 |
| 站点信息 | 站点设置 | 名称、Favicon、背景图、备案、夜间模式、RSS 等 |

---

# 常见问题

<details>
<summary>换域名后需要重新构建前端吗？</summary>

如果 `NEXT_PUBLIC_API_URL` 始终是 `/api`，普通前端域名变更通常不需要修改客户端 API 路径；但如果变更了 `BACKEND_URL`、`NEXT_PUBLIC_SITE_URL` 或 `NEXT_PUBLIC_MEDIA_ORIGIN`，应更新环境变量并重新部署前端。尤其是媒体域名变化会影响 Next Image 白名单，必须重建前端。
</details>

<details>
<summary>发布动态后刷新页面没有更新？</summary>

检查后端 `REVALIDATE_SECRET` 与前端 `REVALIDATE_SECRET` 是否完全一致。该值是服务端密钥，不应带 `NEXT_PUBLIC_` 前缀。
</details>

<details>
<summary>上传到 R2 失败、CORS 报错或图片无法显示？</summary>

1. 确认后端已配置完整 R2 环境变量；
2. 确认 `NEXT_PUBLIC_MEDIA_ORIGIN` 与 `R2_PUBLIC_URL` 完全一致；
3. 确认 R2 Bucket CORS 包含当前前端完整 Origin，且允许 `PUT`、`GET`、`HEAD` 与 `Content-Type`；
4. PUT 阶段 `403` 通常是 R2 凭证、签名或 Content-Type 不匹配；
5. confirm 阶段失败通常与对象 MIME、大小或复制权限有关；
6. Vercel 环境下，媒体会经由 `presign → 浏览器直接 PUT R2 → confirm` 流程，不应改回经 Vercel 函数上传大文件。
</details>

<details>
<summary>TiDB / 托管 MySQL 连接失败？</summary>

确认 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 与服务商 Connect 页面一致。TiDB Cloud 等托管服务通常要求 `DB_SSL=true`。只有服务商明确要求时才设置 `DB_SSL_REJECT_UNAUTHORIZED=false`。
</details>

<details>
<summary>为什么不能在 Vercel 冷启动时自动初始化数据库？</summary>

多个 Serverless 实例可能同时冷启动；若每个实例都执行 DDL，容易产生连接和建表竞争。请在部署前或维护时显式运行 `pnpm db:init`，不要将 `DB_SYNC_ON_BOOT=true` 作为常规生产配置。
</details>

<details>
<summary>高德地图搜索或逆地理编码偶发 502？</summary>

后端高德 Web 服务请求来自 Vercel Serverless 的动态出口 IP。如果高德 Web 服务 Key 绑定了固定 IP，可能出现时好时坏。请确认后端使用的是“Web 服务”类型 Key，并根据实际安全需求取消 IP 绑定或使用固定出口 IP 的代理；不要把 Web 端 JS API Key 填入后端 Web 服务 Key 字段。
</details>

<details>
<summary>忘记管理员密码？</summary>

在后端运行环境中设置新的 `ADMIN_PASSWORD` 后执行：

```bash
cd backend
node dist/scripts/reset-password.js
```

该运维命令会将对应管理员密码重置为当前 `ADMIN_PASSWORD`。
</details>

<details>
<summary>如何查看 VPS 日志？</summary>

```bash
pm2 logs kanle-backend
pm2 logs kanle-frontend
pm2 logs
```
</details>

---

# 本地开发

```bash
# 后端
cd backend
pnpm install
cp .env.example .env
# 编辑 .env 并指向一个已创建的本地/测试数据库
pnpm db:init
pnpm dev
```

另开一个终端：

```bash
# 前端
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

首次开发和生产部署都应显式运行 `pnpm db:init`；应用启动默认不会自动变更数据库表结构。

# License

[MIT](LICENSE)

Copyright (c) 2026 zhjurz
