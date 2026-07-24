import dotenv from "dotenv";
import sequelize from "../config/database";

dotenv.config();

/** Adds the admin-configurable desktop decoration image column. */
export async function migrateDecorationImage() {
  try {
    await sequelize.query(
      "ALTER TABLE site_settings ADD COLUMN decoration_image VARCHAR(500) NOT NULL DEFAULT ''"
    );
    console.log("Applied: ADD COLUMN decoration_image VARCHAR(500) NOT NULL DEFAULT ''");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/duplicate column|already exists/i.test(message)) {
      console.log("Already present: decoration_image");
    } else {
      throw error;
    }
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    await migrateDecorationImage();
  } catch (error) {
    console.error("Decoration image migration failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  void main();
}
