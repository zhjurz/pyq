import sequelize from "../config/database";

async function migrateFontFamily() {
  await sequelize.authenticate();
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
  } finally {
    await sequelize.close();
  }
}

migrateFontFamily().catch(async (error) => {
  console.error("Font family migration failed:", error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
