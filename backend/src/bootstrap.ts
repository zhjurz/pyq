/**
 * 应用初始化（数据库连接 + 模型同步 + 插件预热 + 黑名单清理）
 *
 * 传统部署（PM2/Docker）：src/index.ts 在进程启动时调用一次，随后常驻。
 * Vercel Serverless：每个函数实例（冷启动）调用一次；同一实例后续的
 * "热调用" 会复用已缓存的 Promise，不会重复连接/同步，避免每次请求
 *都打一次 sequelize.sync()。不同函数实例之间互不共享内存，这是
 * Serverless 架构的正常特性（详见 VERCEL_DEPLOYMENT.md）。
 */
import { sequelize } from "./models";
import { loadAllPlugins } from "./music-sources/mf-manager";

let readyPromise: Promise<void> | null = null;

async function doBootstrap(): Promise<void> {
  await sequelize.authenticate();
  console.log("Database connected.");

  // sync() 只会创建缺失的表，不会 alter 已存在的表结构。
  // 表结构变更通过手动 SQL 管理，避免 sync({alter:true}) 导致的
  // 索引重复累积 / ENUM 前导空格等问题。
  await sequelize.sync();
  console.log("Models synchronized.");

  // 启动时清理已过期的黑名单记录（失败不阻断启动）
  try {
    const { blacklistService } = await import("./services/blacklist-service");
    const cleaned = await blacklistService.cleanupExpired();
    if (cleaned > 0) console.log(`Cleaned ${cleaned} expired blacklist entries.`);
  } catch (e) {
    console.warn("Blacklist cleanup skipped:", (e as Error).message);
  }

  // 预热音源插件（从数据库加载，见 music-sources/mf-manager.ts）
  try {
    const result = await loadAllPlugins();
    console.log(`[plugins] loaded ${result.loaded} music source plugin(s)`);
    if (result.failed.length > 0) {
      console.warn("[plugins] failed:", result.failed);
    }
  } catch (e) {
    console.warn("[plugins] load failed:", (e as Error).message);
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
