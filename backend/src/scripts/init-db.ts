import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { MusicPlaylist, sequelize, SiteSetting, siteSettingTextDefaults, User } from "../models";
import { migrateDoubanCache } from "./migrate-douban-cache";
import { migrateFontFamily } from "./migrate-font-family";
import { migrateFooterHtml } from "./migrate-footer-html";

dotenv.config();

const DEFAULT_PLAYLIST_SLUG = "site-default";

function adminConfig() {
  return {
    email: process.env.ADMIN_EMAIL || "admin@kanle.net",
    password: process.env.ADMIN_PASSWORD || "123456",
    username: process.env.ADMIN_USERNAME || "admin",
  };
}

async function ensureSiteSettings() {
  const [settings, created] = await SiteSetting.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1, ...siteSettingTextDefaults },
  });
  console.log(created ? "Site settings created." : "Site settings already exist.");
  return settings;
}

async function ensureDefaultPlaylist() {
  const [playlist, created] = await MusicPlaylist.findOrCreate({
    where: { slug: DEFAULT_PLAYLIST_SLUG },
    defaults: { slug: DEFAULT_PLAYLIST_SLUG, name: "网站歌单" },
  });
  console.log(created ? "Default music playlist created." : "Default music playlist already exists.");
  return playlist;
}

async function ensureAdmin() {
  const existingAdmin = await User.findOne({ where: { role: "admin" }, order: [["createdAt", "ASC"]] });
  const { email, password, username } = adminConfig();

  if (existingAdmin) {
    if (!existingAdmin.username) {
      const usernameOwner = await User.findOne({ where: { username } });
      if (!usernameOwner || usernameOwner.id === existingAdmin.id) {
        await existingAdmin.update({ username });
        console.log(`Existing admin username set to "${username}". Password was not changed.`);
      } else {
        console.warn(`Existing admin has no username, but "${username}" is already in use. No users were changed.`);
      }
    } else {
      console.log(`Admin already exists (${existingAdmin.email}). Password was not changed.`);
    }
    return existingAdmin;
  }

  const emailOwner = await User.findOne({ where: { email } });
  if (emailOwner) {
    throw new Error(`Cannot create admin: ADMIN_EMAIL ${email} already belongs to a non-admin user. Choose another ADMIN_EMAIL or update that user manually.`);
  }

  const usernameOwner = await User.findOne({ where: { username } });
  if (usernameOwner) {
    throw new Error(`Cannot create admin: ADMIN_USERNAME "${username}" is already in use. Choose another ADMIN_USERNAME.`);
  }

  const admin = await User.create({
    email,
    username,
    password: await bcrypt.hash(password, 10),
    nickname: "小予",
    avatar: "",
    cover: "https://picsum.photos/seed/momentscover/1200/600",
    bio: "这是一个朋友圈博客程序",
    role: "admin",
  });
  console.log(`Admin created (${admin.email}).`);
  return admin;
}

/**
 * Initializes an existing database without altering or deleting existing data.
 * This is the only supported first-deployment database setup flow.
 */
export async function initializeDatabase() {
  await sequelize.authenticate();
  console.log("Database connected.");

  // Deliberately omit alter/force: this only creates missing model tables.
  await sequelize.sync();
  console.log("Database tables verified.");

  // Safe, additive compatibility steps for databases created by older releases.
  await migrateDoubanCache();
  await migrateFontFamily();
  await migrateFooterHtml();

  await ensureSiteSettings();
  await ensureDefaultPlaylist();
  await ensureAdmin();

  console.log("Database initialization completed successfully.");
}

async function main() {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  void main();
}
