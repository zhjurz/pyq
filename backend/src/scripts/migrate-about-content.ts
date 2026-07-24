import dotenv from "dotenv";
import sequelize from "../config/database";

dotenv.config();

export async function migrateAboutContent() {
  try {
    await sequelize.query("ALTER TABLE site_settings ADD COLUMN about_content TEXT NULL");
    console.log("Applied: ADD COLUMN about_content TEXT NULL");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/duplicate column|already exists/i.test(message)) {
      console.log("Already present: about_content");
    } else {
      throw error;
    }
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    await migrateAboutContent();
  } catch (error) {
    console.error("About content migration failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  void main();
}
