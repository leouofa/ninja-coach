import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "ninja.db");

mkdirSync(path.dirname(dbPath), { recursive: true });

if (!existsSync(dbPath)) {
  throw new Error(
    `Database not found at ${dbPath}. Run \`npm run db:migrate\` to create and migrate it first.`,
  );
}

const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
