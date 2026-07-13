import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import authRoutes from "./routes/auth";
import postsRoutes from "./routes/posts";
import usersRoutes from "./routes/users";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/upload";
import friendsRoutes from "./routes/friends";
import settingsRoutes from "./routes/settings";
import musicRoutes from "./routes/music";
import notificationsRoutes from "./routes/notifications";
import adsRoutes from "./routes/ads";
import mediaRoutes from "./routes/media";
import locationRoutes from "./routes/location";
import urlPreviewRoutes from "./routes/url-preview";
import videoParseRoutes from "./routes/video-parse";
import pluginsRoutes from "./routes/plugins";
import doubanRoutes from "./routes/douban";
import { visitorCookieMiddleware } from "./middleware/visitor-cookie";
import { ensureReady } from "./bootstrap";

dotenv.config();

/** 允许直接访问 API 的前端源，支持逗号分隔。正常浏览器请求应通过前端 /api rewrite。 */
function buildCorsOrigin() {
  if (process.env.NODE_ENV !== "production") return true;
  const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.CLIENT_URL || "http://localhost:3000";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length <= 1) return list[0] || true;
  return list;
}

const app = express();

app.use(
  cors({
    origin: buildCorsOrigin(),
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(visitorCookieMiddleware);

// 旧本地上传目录仅供非生产开发兼容；生产 R2-only 部署不会写入该目录。
if (!process.env.VERCEL) {
  app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));
}

// 在处理业务路由前确保数据库已连接、表已同步、插件已加载。
// 传统部署下 bootstrap 已在进程启动时执行过一次，这里的 ensureReady()
// 会立即 resolve，不产生额外开销；Serverless 下首次冷启动在此等待初始化。
app.use(async (_req, res, next) => {
  try {
    await ensureReady();
    next();
  } catch (err: any) {
    console.error("Bootstrap failed:", err);
    res.status(503).json({ message: "服务暂时不可用，请稍后重试" });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/url-preview", urlPreviewRoutes);
app.use("/api/video", videoParseRoutes);
app.use("/api/admin/plugins", pluginsRoutes);
app.use("/api/douban", doubanRoutes);

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    const limitMB = Math.round((err.limit || 0) / 1024 / 1024);
    res.status(400).json({ message: `文件过大，最大支持 ${limitMB}MB` });
    return;
  }
  if (err?.name === "MulterError") {
    res.status(400).json({ message: err.message || "文件上传失败" });
    return;
  }
  console.error(err.stack);
  res.status(500).json({ message: err.message || "服务器内部错误" });
});

export default app;
