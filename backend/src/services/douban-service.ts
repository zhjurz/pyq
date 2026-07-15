/**
 * 豆瓣数据抓取与持久化快照服务。
 * 公共读取仅使用 TiDB 快照；只有管理员和定时任务可以调用同步。
 */
import { randomUUID } from "crypto";
import axios from "axios";
import * as cheerio from "cheerio";
import sequelize from "../config/database";
import { SiteSetting } from "../models";

export type DoubanStatus = "collect" | "do" | "wish";
export type DoubanSyncStatus = "never" | "success" | "partial" | "failed" | "running";
type CollectionType = "movie" | "book" | "music";

export interface DoubanItem {
  title: string;
  cover: string;
  link: string;
  rating: number;
  date: string;
  intro: string;
  comment: string;
  status: DoubanStatus;
  statusLabel: string;
}

export interface DoubanCategorySync {
  complete: boolean;
  syncStatus: "success" | "partial" | "failed" | "never";
  syncedAt: string;
  lastError?: string;
}

export interface DoubanCollection {
  movies: DoubanItem[];
  books: DoubanItem[];
  music: DoubanItem[];
  syncedAt: string;
  doubanId: string;
  syncStatus: DoubanSyncStatus;
  lastError?: string;
  dataState: "unconfigured" | "awaiting_first_sync" | "ready";
  categorySync: Record<CollectionType, DoubanCategorySync>;
}

interface ScrapeResult {
  items: DoubanItem[];
  errors: string[];
  complete: boolean;
}

interface SyncLease {
  id: string;
  setting: SiteSetting;
}

const PAGE_SIZE = 15;
const MAX_PAGES_PER_STATUS = 3;
const RUN_BUDGET_MS = 22_000;
const REQUEST_TIMEOUT_MS = 7_000;
const LEASE_MS = 60_000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douban.com/",
};

const STATUS_LABELS: Record<CollectionType, Record<DoubanStatus, string>> = {
  movie: { collect: "看过", do: "在看", wish: "想看" },
  book: { collect: "读过", do: "在读", wish: "想读" },
  music: { collect: "听过", do: "在听", wish: "想听" },
};

function categoryState(status: DoubanCategorySync["syncStatus"] = "never", syncedAt = "", lastError?: string): DoubanCategorySync {
  return { complete: status === "success", syncStatus: status, syncedAt, ...(lastError ? { lastError } : {}) };
}

function emptyCollection(doubanId: string, dataState: DoubanCollection["dataState"]): DoubanCollection {
  return {
    movies: [],
    books: [],
    music: [],
    syncedAt: "",
    doubanId,
    syncStatus: "never",
    dataState,
    categorySync: {
      movie: categoryState(),
      book: categoryState(),
      music: categoryState(),
    },
  };
}

function normalizeSnapshot(raw: string | null, doubanId: string): DoubanCollection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DoubanCollection>;
    if (parsed.doubanId !== doubanId || !Array.isArray(parsed.movies) || !Array.isArray(parsed.books) || !Array.isArray(parsed.music)) return null;
    const syncedAt = typeof parsed.syncedAt === "string" ? parsed.syncedAt : "";
    const categories: Partial<Record<CollectionType, DoubanCategorySync>> = parsed.categorySync || {};
    return {
      movies: parsed.movies,
      books: parsed.books,
      music: parsed.music,
      syncedAt,
      doubanId,
      syncStatus: parsed.syncStatus || "success",
      lastError: parsed.lastError,
      dataState: "ready",
      // Legacy snapshots predate per-category metadata and are last-success snapshots.
      categorySync: {
        movie: categories.movie || categoryState("success", syncedAt),
        book: categories.book || categoryState("success", syncedAt),
        music: categories.music || categoryState("success", syncedAt),
      },
    };
  } catch {
    return null;
  }
}

function parseItems(html: string, type: CollectionType, status: DoubanStatus): DoubanItem[] {
  const $ = cheerio.load(html);
  const items: DoubanItem[] = [];
  const statusLabel = STATUS_LABELS[type][status];
  $(".item").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".title a").text().trim();
    if (!title) return;
    const ratingMatch = ($el.find("[class*='rating']").attr("class") || "").match(/rating(\d)-t/);
    items.push({
      title,
      link: $el.find(".title a").attr("href") || $el.find(".nbg").attr("href") || "",
      cover: $el.find("img").attr("src") || "",
      date: $el.find(".date").text().trim(),
      intro: $el.find(".intro").text().trim(),
      comment: $el.find(".comment").text().trim(),
      rating: ratingMatch ? Number(ratingMatch[1]) : 0,
      status,
      statusLabel,
    });
  });
  return items;
}

function remainingTimeout(deadline: number): number {
  return Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
}

async function scrapeCollection(type: CollectionType, doubanId: string, status: DoubanStatus, deadline: number): Promise<ScrapeResult> {
  const items: DoubanItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES_PER_STATUS; page++) {
    if (Date.now() >= deadline) {
      errors.push(`${type}/${status}: sync deadline reached`);
      return { items, errors, complete: false };
    }
    try {
      const start = page * PAGE_SIZE;
      const url = `https://${type}.douban.com/people/${encodeURIComponent(doubanId)}/${status}?start=${start}`;
      const resp = await axios.get(url, {
        headers: HEADERS,
        timeout: remainingTimeout(deadline),
        maxRedirects: 3,
        validateStatus: () => true,
      });
      if (resp.status !== 200) {
        errors.push(`${type}/${status}: HTTP ${resp.status}`);
        return { items, errors, complete: false };
      }
      const pageItems = parseItems(resp.data, type, status);
      for (const item of pageItems) {
        const key = item.link || `${item.title}:${item.date}:${item.status}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
      if (pageItems.length < PAGE_SIZE) return { items, errors, complete: true };
      if (page === MAX_PAGES_PER_STATUS - 1) {
        errors.push(`${type}/${status}: pagination limit reached`);
        return { items, errors, complete: false };
      }
    } catch (error: any) {
      errors.push(`${type}/${status}: ${error?.code === "ECONNABORTED" ? "timeout" : "request failed"}`);
      return { items, errors, complete: false };
    }
  }
  return { items, errors, complete: false };
}

function sortItems(items: DoubanItem[]) {
  return items.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

async function acquireLease(): Promise<SyncLease | null> {
  const transaction = await sequelize.transaction();
  let completed = false;
  try {
    const setting = await SiteSetting.findByPk(1, { transaction, lock: transaction.LOCK.UPDATE });
    if (!setting) {
      await transaction.commit();
      completed = true;
      throw new Error("站点设置不存在，请先保存一次后台设置");
    }
    const now = new Date();
    if (setting.doubanSyncLeaseExpiresAt && setting.doubanSyncLeaseExpiresAt > now) {
      await transaction.commit();
      completed = true;
      return null;
    }
    const id = randomUUID();
    await setting.update({
      doubanSyncLeaseId: id,
      doubanSyncLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      doubanLastAttemptAt: now,
    }, { transaction });
    await transaction.commit();
    completed = true;
    return { id, setting };
  } catch (error) {
    if (!completed) await transaction.rollback();
    throw error;
  }
}

async function releaseLease(leaseId: string) {
  await SiteSetting.update({ doubanSyncLeaseId: null, doubanSyncLeaseExpiresAt: null }, {
    where: { id: 1, doubanSyncLeaseId: leaseId },
  });
}

async function fetchFresh(doubanId: string, previous: DoubanCollection | null): Promise<DoubanCollection> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const types: CollectionType[] = ["movie", "book", "music"];
  const results = await Promise.all(types.map(async (type) => {
    const statuses = await Promise.all((['collect', 'do', 'wish'] as DoubanStatus[]).map((status) => scrapeCollection(type, doubanId, status, deadline)));
    const errors = statuses.flatMap((result) => result.errors);
    return { type, items: sortItems(statuses.flatMap((result) => result.items)), errors, complete: statuses.every((result) => result.complete) };
  }));

  const now = new Date().toISOString();
  const byType = Object.fromEntries(results.map((result) => [result.type, result])) as Record<CollectionType, typeof results[number]>;
  const allErrors = results.flatMap((result) => result.errors);
  const hasFreshData = results.some((result) => result.items.length > 0);
  if (!hasFreshData && previous) {
    return { ...previous, syncStatus: "failed", lastError: allErrors.join("; ").slice(0, 2000) || "豆瓣未返回可用数据", dataState: "ready" };
  }

  const chooseCategory = (type: CollectionType, key: "movies" | "books" | "music") => {
    const result = byType[type];
    if (result.complete) return result.items;
    return previous?.[key] || result.items;
  };
  const categorySync = (type: CollectionType): DoubanCategorySync => {
    const result = byType[type];
    if (result.complete) return categoryState("success", now);
    if (previous?.categorySync?.[type]?.complete) return { ...previous.categorySync[type], syncStatus: "partial", lastError: result.errors.join("; ").slice(0, 500) || "同步未完成" };
    return categoryState(result.items.length ? "partial" : "failed", now, result.errors.join("; ").slice(0, 500));
  };
  const complete = results.every((result) => result.complete);
  return {
    movies: chooseCategory("movie", "movies"),
    books: chooseCategory("book", "books"),
    music: chooseCategory("music", "music"),
    syncedAt: now,
    doubanId,
    syncStatus: complete ? "success" : hasFreshData ? "partial" : "failed",
    lastError: allErrors.length ? allErrors.join("; ").slice(0, 2000) : undefined,
    dataState: "ready",
    categorySync: {
      movie: categorySync("movie"),
      book: categorySync("book"),
      music: categorySync("music"),
    },
  };
}

/** Public-safe durable read. This function never contacts Douban. */
export async function getStoredDoubanData(doubanId: string): Promise<DoubanCollection> {
  if (!doubanId) return emptyCollection("", "unconfigured");
  const setting = await SiteSetting.findByPk(1);
  const snapshot = normalizeSnapshot(setting?.doubanCache || null, doubanId);
  if (!snapshot) {
    const result = emptyCollection(doubanId, "awaiting_first_sync");
    result.syncStatus = (setting?.doubanSyncStatus as DoubanSyncStatus) || "never";
    result.lastError = setting?.doubanLastError || undefined;
    return result;
  }
  return {
    ...snapshot,
    syncStatus: (setting?.doubanSyncStatus as DoubanSyncStatus) || snapshot.syncStatus || "success",
    lastError: setting?.doubanLastError || snapshot.lastError,
    dataState: "ready",
  };
}

/** Outbound sync for admin and scheduled jobs only. */
export async function syncDoubanData(doubanId: string): Promise<DoubanCollection> {
  if (!doubanId) return emptyCollection("", "unconfigured");
  const lease = await acquireLease();
  if (!lease) {
    const stored = await getStoredDoubanData(doubanId);
    return { ...stored, syncStatus: "running", lastError: "已有同步任务正在运行" };
  }
  try {
    const previous = normalizeSnapshot(lease.setting.doubanCache, doubanId);
    const fresh = await fetchFresh(doubanId, previous);
    const failed = fresh.syncStatus === "failed";
    const [updated] = await SiteSetting.update({
      doubanCache: failed && previous ? lease.setting.doubanCache : JSON.stringify(fresh),
      doubanSyncStatus: fresh.syncStatus,
      doubanSyncedAt: failed ? lease.setting.doubanSyncedAt : new Date(fresh.syncedAt),
      doubanLastError: fresh.lastError || null,
    }, { where: { id: 1, doubanSyncLeaseId: lease.id } });
    if (updated !== 1) throw new Error("同步租约已过期，结果未写入");
    return fresh;
  } finally {
    await releaseLease(lease.id).catch(() => {});
  }
}
