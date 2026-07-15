import sequelize from "../config/database";

const columns = [
  "ADD COLUMN douban_cache MEDIUMTEXT NULL",
  "ADD COLUMN douban_sync_status VARCHAR(20) NOT NULL DEFAULT 'never'",
  "ADD COLUMN douban_synced_at DATETIME NULL",
  "ADD COLUMN douban_last_error TEXT NULL",
];

async function migrateDoubanCache() {
  await sequelize.authenticate();
  for (const definition of columns) {
    try {
      await sequelize.query(`ALTER TABLE site_settings ${definition}`);
      console.log(`Applied: ${definition}`);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (/duplicate column|already exists/i.test(message)) {
        console.log(`Already present: ${definition}`);
      } else {
        throw error;
      }
    }
  }
  await sequelize.close();
}

migrateDoubanCache().catch(async (error) => {
  console.error("Douban cache migration failed:", error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
