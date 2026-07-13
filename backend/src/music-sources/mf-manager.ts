/**
 * MusicFree 插件管理器
 *
 * 持久化：插件代码存储在数据库 MusicSource 表（code 字段），而不是本地
 * 磁盘文件。原因：Vercel Serverless 函数的文件系统只读且不持久（/tmp 除外，
 * 且各函数实例互不共享），无法像传统部署那样把插件写到 backend/plugins/
 * 目录再用 fs.watch 热重载。数据库是两种部署模式（传统 VPS/Docker 与
 * Vercel Serverless）都能访问的共享持久层，因此统一改为数据库存储。
 *
 * 内存中仍然维护一份"已加载插件"的运行时缓存（loadedPlugins），避免每次
 * 请求都重新执行插件代码：
 * - 单进程长驻部署（PM2/Docker）：等价于原来的效果，进程生命周期内只加载一次。
 * - Serverless：每个函数实例的内存独立，冷启动时从数据库加载一次；同一实例
 *   后续的热调用复用内存缓存。跨实例的最终一致性通过 TTL 定期重新对账
 *   （ensurePluginsFresh）实现——见文件末尾说明。
 *
 * - 支持 .js 单文件安装（上传/在线 URL）
 * - 支持 .json 订阅（一次安装多个插件）
 * - 安装时校验 platform / version，相同 platform 旧版本拒绝安装
 * - 通过 registerSource() 把适配后的 MusicSource 注入到全局注册表
 */
import axios from "axios";
import { loadPluginFromCode, compareVersion } from "./mf-loader";
import { adaptPlugin } from "./mf-adapter";
import { registerSource, unregisterSource } from "./index";
import { MusicSource } from "../models";
import type { LoadedMusicFreePlugin } from "./mf-types";
import type { IPluginSubscription } from "./mf-types";

/** 已加载插件的内存缓存：key = MusicSource 数据库行 id */
const loadedPlugins = new Map<string, LoadedMusicFreePlugin>();

/** platform → id 反向索引（用于版本比较/重复检测） */
const platformIndex = new Map<string, string>();

/** 距离上次从数据库对账的时间戳 */
let lastSyncAt = 0;

/**
 * 对账 TTL：同一 Serverless 函数实例在这个时间窗口内不会重新查询数据库，
 * 直接复用内存缓存。窗口越短，多实例间插件增删的可见延迟越低，但数据库
 * 查询也越频繁；60 秒是常规访问量下的合理折中，可按需调整。
 * 注意：处理"安装/删除插件"请求的那次调用总是立即生效（写库后直接更新
 * 本实例内存），受 TTL 影响的只是"没有触发写操作的其它只读实例"多久能看到别处的变更。
 */
const SYNC_TTL_MS = 60_000;

/** 列出所有已加载插件（前端 admin API 用） */
export async function listPlugins(): Promise<Array<{
  id: string;
  platform: string;
  version: string;
  author: string;
  description?: string;
  srcUrl?: string;
  primaryKey?: string[];
  supportedSearchType?: string[];
  methods: string[];
  fileName: string;
}>> {
  await ensurePluginsFresh();
  return Array.from(loadedPlugins.values()).map((p) => ({
    id: p.fileName,
    platform: p.platform,
    version: p.instance.version || "0.0.0",
    author: p.instance.author || "",
    description: p.instance.description,
    srcUrl: p.srcUrl,
    primaryKey: p.instance.primaryKey,
    supportedSearchType: p.instance.supportedSearchType,
    methods: Object.keys(p.instance).filter(
      (k) =>
        k !== "platform" &&
        k !== "version" &&
        k !== "author" &&
        k !== "description" &&
        k !== "srcUrl" &&
        k !== "primaryKey" &&
        k !== "supportedSearchType" &&
        k !== "cacheControl" &&
        k !== "hints" &&
        k !== "appVersion" &&
        k !== "defaultSearchType" &&
        k !== "userVariables" &&
        typeof (p.instance as any)[k] === "function"
    ),
    fileName: p.fileName,
  }));
}

/** 文件名净化：只保留字母数字下划线连字符（用于安装时的建议名/日志展示） */
function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^\w\-]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "plugin"
  );
}

/** 把插件的可索引字段序列化进 MusicSource 行 */
function buildRowFields(loaded: LoadedMusicFreePlugin, code: string) {
  return {
    name: loaded.platform,
    platform: loaded.platform,
    url: loaded.srcUrl || "",
    version: loaded.instance.version || "",
    author: loaded.instance.author || "",
    code,
    codeHash: loaded.hash,
    srcUrl: loaded.srcUrl || "",
    description: loaded.instance.description || "",
    supportedSearchType: JSON.stringify(loaded.instance.supportedSearchType || ["music"]),
    primaryKey: JSON.stringify(loaded.instance.primaryKey || ["id"]),
    enabled: true,
  };
}

/** 注册一个已加载插件到内存 + 全局音源注册表 */
function registerLoadedPlugin(plugin: LoadedMusicFreePlugin): void {
  loadedPlugins.set(plugin.fileName, plugin);
  platformIndex.set(plugin.platform, plugin.fileName);
  registerSource(plugin.platform, adaptPlugin(plugin));
}

/** 从内存 + 注册表移除一个插件 */
function unregisterLoadedPlugin(id: string): void {
  const plugin = loadedPlugins.get(id);
  if (!plugin) return;
  // 仅当当前 platform 仍指向此 id 时才注销（避免误删新版本）
  if (platformIndex.get(plugin.platform) === id) {
    unregisterSource(plugin.platform);
    platformIndex.delete(plugin.platform);
  }
  loadedPlugins.delete(id);
}

/**
 * 将内存缓存与数据库对账：新增数据库中有但内存没有的插件，移除数据库中
 * 已不存在的插件，重新加载 codeHash 发生变化的插件。
 */
async function reconcile(): Promise<void> {
  const rows = await MusicSource.findAll();
  const dbIds = new Set(rows.map((r) => r.id));

  for (const id of Array.from(loadedPlugins.keys())) {
    if (!dbIds.has(id)) {
      unregisterLoadedPlugin(id);
      console.log(`[plugins] unloaded (removed from db): ${id}`);
    }
  }

  for (const row of rows) {
    const existing = loadedPlugins.get(row.id);
    if (existing && existing.hash === row.codeHash) continue; // 未变化，跳过

    try {
      const loaded = loadPluginFromCode(row.code, row.id);
      loaded.srcUrl = row.srcUrl || loaded.srcUrl;
      if (existing) unregisterLoadedPlugin(row.id);
      registerLoadedPlugin(loaded);
      console.log(
        `[plugins] ${existing ? "reloaded" : "loaded"} ${row.id}: ${loaded.platform} v${loaded.instance.version || "0.0.0"}`
      );
    } catch (err: any) {
      console.error(`[plugins] failed to load db row ${row.id} (${row.platform}):`, err?.message || err);
    }
  }

  lastSyncAt = Date.now();
}

/** 确保内存缓存不超过 TTL 地陈旧（供路由在处理请求前调用） */
export async function ensurePluginsFresh(): Promise<void> {
  if (Date.now() - lastSyncAt < SYNC_TTL_MS) return;
  await reconcile();
}

/**
 * 安装插件（从代码字符串）
 * - 若同 platform 已有相同 hash，跳过（返回已安装记录）
 * - 若同 platform 已有更旧版本，拒绝安装
 * - 若同 platform 已有更旧/相同版本号但内容不同，覆盖升级
 * @returns 已加载插件记录
 */
export async function installPluginFromCode(
  code: string,
  suggestedName?: string
): Promise<LoadedMusicFreePlugin> {
  const tempName = suggestedName ? `${sanitizeFileName(suggestedName)}.js` : "plugin.js";
  const loaded = loadPluginFromCode(code, tempName);

  const existingRow = await MusicSource.findOne({ where: { platform: loaded.platform } });

  if (existingRow) {
    if (existingRow.codeHash === loaded.hash) {
      console.log(`[plugins] skip install: ${loaded.platform} already exists with same hash`);
      let cached = loadedPlugins.get(existingRow.id);
      if (!cached) {
        cached = loadPluginFromCode(existingRow.code, existingRow.id);
        cached.srcUrl = existingRow.srcUrl || cached.srcUrl;
        registerLoadedPlugin(cached);
      }
      return cached;
    }

    const cmp = compareVersion(loaded.instance.version || "0.0.0", existingRow.version || "0.0.0");
    if (cmp < 0) {
      throw new Error(
        `插件 ${loaded.platform} v${loaded.instance.version} 低于已安装的 v${existingRow.version}，拒绝安装`
      );
    }

    await existingRow.update(buildRowFields(loaded, code));
    unregisterLoadedPlugin(existingRow.id);
    const finalLoaded = loadPluginFromCode(code, existingRow.id);
    finalLoaded.srcUrl = loaded.srcUrl;
    registerLoadedPlugin(finalLoaded);
    console.log(
      `[plugins] updated ${existingRow.id}: ${finalLoaded.platform} v${finalLoaded.instance.version}`
    );
    return finalLoaded;
  }

  const row = await MusicSource.create(buildRowFields(loaded, code) as any);
  const finalLoaded = loadPluginFromCode(code, row.id);
  finalLoaded.srcUrl = loaded.srcUrl;
  registerLoadedPlugin(finalLoaded);
  console.log(
    `[plugins] installed ${row.id}: ${finalLoaded.platform} v${finalLoaded.instance.version}` +
      (finalLoaded.instance.author ? ` by ${finalLoaded.instance.author}` : "")
  );
  return finalLoaded;
}

/**
 * 从上传的文件安装插件（multipart 上传场景）。
 * 上传文件经 multer 落到 os.tmpdir()（Vercel /tmp 可写），读取后立即清理。
 */
export async function installPluginFromFile(file: {
  originalname: string;
  path: string;
}): Promise<LoadedMusicFreePlugin> {
  const fs = await import("fs");
  const path = await import("path");
  const code = fs.readFileSync(file.path, "utf8");
  const suggestedName = path.basename(file.originalname, ".js");
  const loaded = await installPluginFromCode(code, suggestedName);
  try {
    fs.unlinkSync(file.path);
  } catch {
    // ignore
  }
  return loaded;
}

/**
 * 从在线 URL 下载并安装单个 .js 插件
 */
export async function installPluginFromUrl(url: string): Promise<LoadedMusicFreePlugin> {
  const resp = await axios.get(url, {
    timeout: 30000,
    responseType: "text",
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/javascript, application/javascript, */*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`下载失败: HTTP ${resp.status}`);
  }
  const code = typeof resp.data === "string" ? resp.data : String(resp.data);
  if (!code || code.length < 50) {
    throw new Error("下载的脚本内容过短，可能不是有效的插件");
  }
  const loaded = await installPluginFromCode(code);
  // 记录来源 URL，便于后续手动更新参考
  const row = await MusicSource.findOne({ where: { platform: loaded.platform } });
  if (row && row.srcUrl !== url) {
    await row.update({ srcUrl: url, url });
  }
  return loaded;
}

/**
 * 订阅插件 JSON（一次安装多个插件）
 *
 * JSON 格式：{ plugins: [{ name, url, version? }] }
 * 单个插件失败不阻断其他插件
 */
export async function subscribePlugins(
  subscriptionUrl: string
): Promise<{
  total: number;
  installed: number;
  skipped: number;
  failed: Array<{ name: string; error: string }>;
}> {
  const resp = await axios.get(subscriptionUrl, {
    timeout: 30000,
    responseType: "json",
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`订阅失败: HTTP ${resp.status}`);
  }
  const sub = resp.data as IPluginSubscription;
  if (!sub || !Array.isArray(sub.plugins) || sub.plugins.length === 0) {
    throw new Error("订阅 JSON 格式错误：缺少 plugins 数组");
  }

  let installed = 0;
  let skipped = 0;
  const failed: Array<{ name: string; error: string }> = [];

  for (const item of sub.plugins) {
    if (!item.url) {
      failed.push({ name: item.name || "未知", error: "缺少 url 字段" });
      continue;
    }
    try {
      await installPluginFromUrl(item.url);
      installed++;
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (/already exists|低于已安装|拒绝安装/.test(msg)) {
        skipped++;
      } else {
        failed.push({ name: item.name || item.url, error: msg });
      }
    }
  }

  return { total: sub.plugins.length, installed, skipped, failed };
}

/** 删除插件（id = MusicSource 数据库行 id） */
export async function removePlugin(id: string): Promise<boolean> {
  const row = await MusicSource.findByPk(id);
  if (!row) return false;

  unregisterLoadedPlugin(id);
  await row.destroy();
  console.log(`[plugins] removed ${id}`);
  return true;
}

/** 启动时（冷启动 / 进程启动）加载所有插件 */
export async function loadAllPlugins(): Promise<{
  loaded: number;
  failed: Array<{ file: string; error: string }>;
}> {
  const rows = await MusicSource.findAll();
  let loaded = 0;
  const failed: Array<{ file: string; error: string }> = [];

  for (const row of rows) {
    try {
      const finalLoaded = loadPluginFromCode(row.code, row.id);
      finalLoaded.srcUrl = row.srcUrl || finalLoaded.srcUrl;
      registerLoadedPlugin(finalLoaded);
      loaded++;
    } catch (err: any) {
      failed.push({ file: row.platform, error: err?.message || String(err) });
      console.error(`[plugins] failed to load ${row.platform} (${row.id}):`, err?.message || err);
    }
  }

  lastSyncAt = Date.now();
  return { loaded, failed };
}
