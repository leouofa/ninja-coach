import type Database from "better-sqlite3";

// Mirrors EMBEDDING_DIMENSIONS from src/lib/embeddings (kept separate so the
// data layer does not pull in the transformers pipeline). The acceptance
// script asserts they stay in sync.
export const VECTOR_DIMENSIONS = 768;

export const VECTOR_TABLE = "embedding_vectors";

const CREATE_VECTOR_TABLE = `
CREATE VIRTUAL TABLE IF NOT EXISTS ${VECTOR_TABLE} USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${VECTOR_DIMENSIONS}] distance_metric=cosine
)`;

// Created at runtime rather than via a migration because drizzle-kit's CLI
// connection cannot load the sqlite-vec extension.
export function ensureVectorSchema(sqlite: Database.Database): void {
  sqlite.exec(CREATE_VECTOR_TABLE);
}
