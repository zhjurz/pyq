import fs from "fs";
import path from "path";
import { QueryTypes } from "sequelize";
import sequelize from "../config/database";
import { Media, MusicPlaylist, MusicTrack, Post } from "../models";

const APPLY = process.argv.includes("--apply");
const backupDir = path.resolve(process.cwd(), "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function parseJson(value: unknown) {
  if (typeof value === "object" && value) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

function sanitizeArticleMusicEmbeds(content: string, mediaByUrl: Map<string, Media>) {
  return content.replace(/<div\b(?=[^>]*\bdata-embed=["']music["'])[^>]*\bdata-payload=["']([^"']+)["'][^>]*>[\s\S]*?<\/div>/gi, (block, payload) => {
    try {
      const music = JSON.parse(decodeURIComponent(Buffer.from(payload, "base64").toString("utf8"))) as Record<string, unknown>;
      const url = typeof music.url === "string" ? music.url : "";
      const media = mediaByUrl.get(url);
      if (!media) return "";
      const normalized = {
        name: typeof music.name === "string" && music.name ? music.name : media.filename.replace(/\.[^.]+$/, ""),
        artist: typeof music.artist === "string" ? music.artist : "",
        cover: typeof music.cover === "string" ? music.cover : "",
        url: media.url,
        source: "upload",
        ...(typeof music.lrc === "string" && music.lrc ? { lrc: music.lrc } : {}),
        ...(typeof music.autoplay === "boolean" ? { autoplay: music.autoplay } : {}),
      };
      const encoded = Buffer.from(encodeURIComponent(JSON.stringify(normalized)), "utf8").toString("base64");
      return block.replace(payload, encoded);
    } catch { return ""; }
  });
}

async function main() {
  await sequelize.authenticate();
  if (APPLY) await sequelize.sync();
  const [settings] = await sequelize.query("SELECT * FROM site_settings WHERE id = 1", { type: QueryTypes.SELECT }) as any[];
  const pluginRows = await sequelize.query("SELECT * FROM music_sources", { type: QueryTypes.SELECT }).catch(() => []);
  const posts = await Post.findAll({ attributes: ["id", "music", "content"] });
  const audioMedia = await Media.findAll({ where: sequelize.where(sequelize.col("mime_type"), "LIKE", "audio/%") });
  const mediaByUrl = new Map(audioMedia.map((media) => [media.url, media]));
  const report = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    legacySettings: settings || null,
    pluginCount: pluginRows.length,
    audioMediaCount: audioMedia.length,
    posts: posts.map((post) => ({ id: post.id, music: post.music, hasMusicEmbed: String(post.content || "").includes("music") })),
  };
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `music-plugin-migration-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`Backup inventory written: ${backupFile}`);
  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply only after reviewing the backup inventory.");
    return;
  }

  const transaction = await sequelize.transaction();
  try {
    const [playlist] = await MusicPlaylist.findOrCreate({ where: { slug: "site-default" }, defaults: { slug: "site-default", name: "网站歌单" }, transaction });
    const legacyUrl = typeof settings?.music_url === "string" ? settings.music_url : settings?.musicUrl;
    if (typeof legacyUrl === "string" && legacyUrl) {
      const media = mediaByUrl.get(legacyUrl);
      if (media) {
        const exists = await MusicTrack.findOne({ where: { playlistId: playlist.id, audioMediaId: media.id }, transaction });
        if (!exists) await MusicTrack.create({ playlistId: playlist.id, audioMediaId: media.id, title: media.filename.replace(/\.[^.]+$/, ""), artist: "", sortOrder: 0 }, { transaction });
      }
    }
    for (const post of posts) {
      const music = parseJson(post.music);
      if (!music) continue;
      const url = typeof music.url === "string" ? music.url : "";
      const media = mediaByUrl.get(url);
      const normalized = media ? {
        name: typeof music.name === "string" && music.name ? music.name : media.filename.replace(/\.[^.]+$/, ""),
        artist: typeof music.artist === "string" ? music.artist : "",
        cover: typeof music.cover === "string" ? music.cover : "",
        url: media.url,
        source: "upload" as const,
        ...(typeof music.lrc === "string" && music.lrc ? { lrc: music.lrc } : {}),
        ...(typeof music.autoplay === "boolean" ? { autoplay: music.autoplay } : {}),
      } : null;
      const content = sanitizeArticleMusicEmbeds(String(post.content || ""), mediaByUrl);
      await post.update({ music: normalized, content }, { transaction });
    }
    await transaction.commit();
    // MySQL/TiDB DDL implicitly commits, so destructive schema cleanup deliberately runs
    // after the data transaction has completed successfully.
    await sequelize.query("DELETE FROM music_sources").catch(() => undefined);
    const legacyColumns = ["music_url", "music_id", "music_source", "playlistId", "musicUrl", "musicId", "musicSource", "playlist_id"];
    for (const column of legacyColumns) {
      await sequelize.query(`ALTER TABLE site_settings DROP COLUMN \`${column}\``).catch(() => undefined);
    }
    await sequelize.query("DROP TABLE IF EXISTS music_sources");
    console.log("R2-only music migration applied successfully.");
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => sequelize.close());
