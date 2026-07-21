import dotenv from "dotenv";
import sequelize from "../config/database";

dotenv.config();

/** Adds the font-family setting column required by current releases. */
export async function migrateFontFamily() {
  try {
    await sequelize.query(
      "ALTER TABLE site_settings ADD COLUMN font_family VARCHAR(200) NOT NULL DEFAULT '' AFTER font_url"
    );
    console.log("Applied: ADD COLUMN font_family VARCHAR(200) NOT NULL DEFAULT ''");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/duplicate column|already exists/i.test(message)) {
      console.log("Already present: font_family");
    } else {
      throw error;
    }
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    await migrateFontFamily();
  } catch (error) {
    console.error("Font family migration failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  void main();
}
