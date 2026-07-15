/**
 * 豆瓣数据抓取与持久化快照服务。
 * Vercel 实例内缓存仅用于减轻并发请求；TiDB 中的最后成功快照才是读取来源。
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { SiteSetting } from "../models";

export type DoubanStatus = "collect" | "do" | "wish";
export type DoubanSyncStatus = "never" | "success" | "partial" | "failed";

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

export interface DoubanCollection {
  movies: DoubanItem[];
  books: DoubanItem[];
  music: DoubanItem[];
  syncedAt: string;
  doubanId: string;
  syncStatus?: DoubanSyncStatus;
  lastError?: string;
}

interface CacheEntry {
  data: DoubanCollection;
  expiresAt: number;
}

interface ScrapeResult {
  items: DoubanItem[];
  errors: string[];
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DoubanCollection>>();
const CACHE_TTL = 30 * 60 * 1000;
const PAGE_SIZE = 15;
const MAX_PAGES = 20;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douban.com/",
};

type CollectionType = "movie" | "book" | "music";
const STATUS_LABELS: Record<CollectionType, Record<DoubanStatus, string>> = {
  movie: { collect: "看过", do: "在看", wish: "想看" },
  book: { collect: "读过", do: "在读", wish: "想读" },
  music: { collect: "听过", do: "在听", wish: "想听" },
};

function emptyCollection(doubanId: string): DoubanCollection {
  return { movies: [], books: [], music: [], syncedAt: "", doubanId, syncStatus: "never" };
}

function parseSnapshot(raw: string | null, doubanId: string): DoubanCollection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DoubanCollection;
    if (parsed && parsed.doubanId === doubanId && Array.isArray(parsed.movies) && Array.isArray(parsed.books) && Array.isArray(parsed.music)) return parsed;
  } catch {
    // A corrupt cache must never make the public endpoint fail.
  }
  return null;
}

function parseItems(html: string, type: CollectionType, status: DoubanStatus): DoubanItem[] {
  const $ = cheerio.load(html);
  const items: DoubanItem[] = [];
  const statusLabel = STATUS_LABELS[type][status];
  $(".item").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".title a").text().trim();
    if (!title) return;
    const ratingClass = $el.find("[class*='rating']").attr("class") || "";
    const ratingMatch = ratingClass.match(/rating(\d)-t/);
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

async function scrapeCollection(type: CollectionType, doubanId: string, status: DoubanStatus): Promise<ScrapeResult> {
  const items: DoubanItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const url = `https://${type}.douban.com/people/${encodeURIComponent(doubanId)}/${status}?start=${start}`;
    try {
      const resp = await axios.get(url, { headers: HEADERS, timeout: 15_000, maxRedirects: 3, validateStatus: () => true });
      if (resp.status !== 200) {
        errors.push(`${type}/${status}: HTTP ${resp.status}`);
        break;
      }
      const pageItems = parseItems(resp.data, type, status);
      for (const item of pageItems) {
        const key = item.link || `${item.title}:${item.date}:${item.status}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
      if (pageItems.length < PAGE_SIZE) break;
    } catch (error: any) {
      errors.push(`${type}/${status}: ${error?.code === "ECONNABORTED" ? "timeout" : "request failed"}`);
      break;
    }
  }
  return { items, errors };
}

function sortItems(items: DoubanItem[]) {
  return items.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

async function fetchFresh(doubanId: string, previous: DoubanCollection | null): Promise<DoubanCollection> {
  const types: CollectionType[] = ["movie", "book", "music"];
  const results = await Promise.all(types.map(async (type) => {
    const statusResults = await Promise.all((["collect", "do", "wish"] as DoubanStatus[]).map((status) => scrapeCollection(type, doubanId, status)));
    return { type, items: sortItems(statusResults.flatMap((result) => result.items)), errors: statusResults.flatMap((result) => result.errors) };
  }));

  const byType: Record<CollectionType, ScrapeResult> = {
    movie: results.find((result) => result.type === "movie")!,
    book: results.find((result) => result.type === "book")!,
    music: results.find((result) => result.type === "music")!,
  };
  const allErrors = results.flatMap((result) => result.errors);
  const hasAnyFreshData = results.some((result) => result.items.length > 0);
  if (!hasAnyFreshData && previous) {
    return { ...previous, syncStatus: "failed", lastError: allErrors.join("; ").slice(0, 2000) || "豆瓣未返回可用数据" };
  }

  const usePrevious = (type: CollectionType, key: "movies" | "books" | "music") =>
    byType[type].errors.length > 0 && byType[type].items.length === 0 && previous ? previous[key] : byType[type].items;
  const status: DoubanSyncStatus = allErrors.length > 0 ? "partial" : "success";
  return {
    movies: usePrevious("movie", "movies"),
    books: usePrevious("book", "books"),
    music: usePrevious("music", "music"),
    syncedAt: new Date().toISOString(),
    doubanId,
    syncStatus: status,
    lastError: allErrors.length ? allErrors.join("; ").slice(0, 2000) : undefined,
  };
}

/** Read a durable snapshot without making external requests. */
export async function getStoredDoubanData(doubanId: string): Promise<DoubanCollection | null> {
  if (!doubanId) return emptyCollection("");
  const setting = await SiteSetting.findByPk(1);
  const snapshot = parseSnapshot(setting?.doubanCache || null, doubanId);
  if (!snapshot) return null;
  return { ...snapshot, syncStatus: (setting?.doubanSyncStatus as DoubanSyncStatus) || snapshot.syncStatus || "success", lastError: setting?.doubanLastError || snapshot.lastError };
}

/** Synchronize, preserve the last good snapshot on an upstream outage, and persist the outcome. */
export async function syncDoubanData(doubanId: string): Promise<DoubanCollection> {
  if (!doubanId) return emptyCollection("");
  const existing = inFlight.get(doubanId);
  if (existing) return existing;
  const task = (async () => {
    const setting = await SiteSetting.findByPk(1);
    const previous = parseSnapshot(setting?.doubanCache || null, doubanId);
    const fresh = await fetchFresh(doubanId, previous);
    const failed = fresh.syncStatus === "failed";
    if (setting) {
      await setting.update({
        doubanCache: failed ? setting.doubanCache : JSON.stringify(fresh),
        doubanSyncStatus: fresh.syncStatus || "failed",
        doubanSyncedAt: failed ? setting.doubanSyncedAt : new Date(fresh.syncedAt),
        doubanLastError: fresh.lastError || null,
      });
    }
    const response = failed && previous ? fresh : fresh;
    cache.set(doubanId, { data: response, expiresAt: Date.now() + CACHE_TTL });
    return response;
  })();
  inFlight.set(doubanId, task);
  try { return await task; } finally { inFlight.delete(doubanId); }
}

export async function getDoubanData(doubanId: string, forceRefresh = false): Promise<DoubanCollection> {
  if (!doubanId) return emptyCollection("");
  if (!forceRefresh) {
    const cached = cache.get(doubanId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const stored = await getStoredDoubanData(doubanId);
    if (stored) {
      cache.set(doubanId, { data: stored, expiresAt: Date.now() + CACHE_TTL });
      return stored;
    }
  }
  return syncDoubanData(doubanId);
}
