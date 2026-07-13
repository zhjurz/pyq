/**
 * 传统部署入口（PM2 / Docker / 裸机 node dist/index.js）。
 *
 * 这是一个长期运行的进程：启动时初始化一次数据库连接和插件，随后
 * 用 app.listen() 常驻监听端口。
 *
 * Vercel Serverless 部署请使用 api/index.ts（不会执行本文件）——
 * 两者共享同一个 src/app.ts（路由/中间件）和 src/bootstrap.ts（初始化逻辑），
 * 业务逻辑完全一致，只是进程模型不同。详见 VERCEL_DEPLOYMENT.md。
 */
import app from "./app";
import { ensureReady } from "./bootstrap";

const PORT = process.env.PORT || 4000;

async function main() {
  try {
    await ensureReady();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to bootstrap backend:", error);
    process.exit(1);
  }
}

main();
