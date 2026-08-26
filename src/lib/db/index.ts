import "server-only";

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import * as schema from "./schema";
import { ensureVectorSchema } from "./vector-schema";

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

sqlite.pragma("busy_timeout = 5000");

if (sqlite.pragma("journal_mode", { simple: true }) !== "wal") {
  sqlite.pragma("journal_mode = WAL");
}
sqlite.pragma("foreign_keys = ON");

sqliteVec.load(sqlite);

export const db = drizzle(sqlite, { schema });

ensureVectorSchema(sqlite);

export type Database = typeof db;
