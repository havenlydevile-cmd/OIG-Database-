// Database client and utilities
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = postgres(databaseUrl, { max: 10 });
export const db = drizzle(sql, { schema });

// Re-export schema for use in other parts of the app
export * from "./schema";
