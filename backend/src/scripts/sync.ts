import dotenv from "dotenv";
import { sequelize } from "../models";

dotenv.config();

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log("Database schema synchronized.");
  } catch (error) {
    console.error("Database schema synchronization failed:", error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

syncDatabase();
