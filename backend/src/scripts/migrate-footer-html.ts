import dotenv from "dotenv";
import sequelize from "../config/database";
import { DEFAULT_FOOTER_HTML } from "../models/SiteSetting";

dotenv.config();

/** Adds the admin-editable footer HTML column required by current releases. */
export async function migrateFooterHtml() {
  // TEXT/BLOB defaults are not portable across MySQL/TiDB; add nullable first then backfill.
  try {
    await sequelize.query(
      "ALTER TABLE site_settings ADD COLUMN footer_html TEXT NULL"
    );
    console.log("Applied: ADD COLUMN footer_html TEXT NULL");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (/duplicate column|already exists/i.test(message)) {
      console.log("Already present: footer_html");
    } else {
      throw error;
    }
  }

  // Backfill empty values so existing installs get the previous default footer.
  await sequelize.query(
    "UPDATE site_settings SET footer_html = :footerHtml WHERE footer_html IS NULL OR footer_html = ''",
    { replacements: { footerHtml: DEFAULT_FOOTER_HTML } }
  );
}

async function main() {
  try {
    await sequelize.authenticate();
    await migrateFooterHtml();
  } catch (error) {
    console.error("Footer HTML migration failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
}

if (require.main === module) {
  void main();
}
