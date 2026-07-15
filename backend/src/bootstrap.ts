/**
 * 应用初始化（数据库连接 + 模型同步 + 黑名单清理）
 *
 * 传统部署（PM2/Docker）：src/index.ts 在进程启动时调用一次，随后常驻。
 * 生产 Vercel 实例只验证数据库连接并预热运行时状态；建表必须通过
 * `npm run db:sync` 在部署前受控执行，避免冷启动触发 DDL 竞争。
 */
import { sequelize } from "./models";

let readyPromise: Promise<void> | null = null;

async function doBootstrap(): Promise<void> {
  await sequelize.authenticate();
  console.log("Database connected.");

  // Serverless 生产请求禁止执行 DDL。首次建表和版本升级必须通过
  // `npm run db:sync` 在部署前受控完成，避免多个冷启动实例并发 sync。
  if (!process.env.VERCEL || process.env.DB_SYNC_ON_BOOT === "true") {
    await sequelize.sync();
    console.log("Models synchronized.");
  }

  // 启动时清理已过期的黑名单记录（失败不阻断启动）
  try {
    const { blacklistService } = await import("./services/blacklist-service");
    const cleaned = await blacklistService.cleanupExpired();
    if (cleaned > 0) console.log(`Cleaned ${cleaned} expired blacklist entries.`);
  } catch (e) {
    console.warn("Blacklist cleanup skipped:", (e as Error).message);
  }
}

/**
 * 确保应用已初始化。可安全地多次调用——同一进程内只会真正执行一次，
 * 并发调用会等待同一个 Promise（不会触发多次并发的 sync()）。
 * 初始化失败时清空缓存，允许下一次请求重试（避免一次网络抖动导致
 * 整个函数实例永久卡死在失败状态）。
 */
export function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = doBootstrap().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
