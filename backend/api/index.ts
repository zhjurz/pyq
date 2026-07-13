/**
 * Vercel Serverless 函数入口。
 *
 * Vercel 的 Node.js Runtime 会把 /api 目录下的每个文件当作一个函数。
 * Express app 本身就是一个 `(req, res) => void` 的请求处理函数，
 * 因此这里直接把 src/app.ts 导出的 app 转发过去即可，不需要额外框架
 * 适配层（如 serverless-http）。
 *
 * 数据库连接 / 表同步 / 插件预热等初始化逻辑封装在 src/bootstrap.ts 的
 * ensureReady() 中，并已经作为 Express 中间件挂在 app 内部（见
 * src/app.ts），所以每个请求都会自动确保初始化完成——冷启动时等待
 * 一次，同一函数实例后续的热调用会直接复用缓存结果。
 *
 * 对应的 vercel.json 已将所有请求 rewrite 到这个函数。
 */
import type { IncomingMessage, ServerResponse } from "http";
import app from "../src/app";

export const config = {
  // Vercel 默认使用 Node.js runtime；显式声明避免被误判为 Edge Runtime
  // （Edge Runtime 不支持 mysql2 等 Node 原生模块）。
  runtime: "nodejs",
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
