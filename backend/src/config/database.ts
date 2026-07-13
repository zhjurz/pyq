import { Sequelize } from "sequelize";
import mysql2 from "mysql2";
import dotenv from "dotenv";

dotenv.config();

/**
 * 是否运行在 Serverless 环境（Vercel 会自动注入 VERCEL=1）。
 * 用于调整连接池策略：Serverless 下同一时刻可能有很多个函数实例
 * 并发运行，每个实例都会持有自己的连接池，如果每个实例都保持
 * 较大的连接池，很容易把 MySQL 的 max_connections 打满。
 * 因此 Serverless 下默认使用很小的连接池 + 较短的空闲回收时间，
 * 让空闲连接尽快释放；传统长驻进程部署（PM2/Docker）则维持
 * 原来较大的连接池以获得更好的吞吐。
 *
 * 两种场景都可以通过 DB_POOL_MAX / DB_POOL_IDLE 环境变量覆盖默认值。
 * 生产环境建议使用支持大量短连接的 MySQL（如 PlanetScale、TiDB Serverless、
 * 或在数据库前加连接池代理如 RDS Proxy / ProxySQL），详见 VERCEL_DEPLOYMENT.md。
 */
const isServerless = !!process.env.VERCEL;

const defaultPoolMax = isServerless ? 2 : 10;
const defaultPoolIdleMs = isServerless ? 5_000 : 10_000;

const sequelize = new Sequelize(
  process.env.DB_NAME || "moment_blog",
  process.env.DB_USER || "root",
  process.env.DB_PASSWORD || "",
  {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    // Sequelize 内部默认用 require('mysql2') 动态加载驱动。Vercel 的 Serverless
    // 函数打包（Node File Trace）是基于静态分析的依赖追踪，对这种嵌套在
    // sequelize 内部的动态 require 经常追踪不到，导致 mysql2 没有被打进部署包，
    // 运行时报 "Please install mysql2 package manually"。这里显式在业务代码里
    // 静态 import mysql2 并通过 dialectModule 传入，绕开 Sequelize 内部的动态
    // require，从根源上解决这个问题（VPS/Docker 部署不受影响，本来就没有这个问题）。
    dialectModule: mysql2,
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    dialectOptions: {
      // 大多数托管 MySQL（PlanetScale / TiDB Serverless / 阿里云 RDS 等）
      // 对外连接要求 TLS；本地/内网 MySQL 通常不需要，用环境变量按需开启。
      ssl:
        process.env.DB_SSL === "true"
          ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
          : undefined,
      connectTimeout: 10_000,
    },
    pool: {
      max: Number(process.env.DB_POOL_MAX || defaultPoolMax),
      min: 0,
      idle: Number(process.env.DB_POOL_IDLE || defaultPoolIdleMs),
      acquire: 15_000,
    },
    define: {
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
      timestamps: true,
      underscored: true,
    },
  }
);

export default sequelize;
