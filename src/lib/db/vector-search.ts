import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "./index";
import {
  embeddings,
  type Embedding,
} from "./schema";
import { VECTOR_DIMENSIONS, VECTOR_TABLE } from "./vector-schema";

export interface InsertEmbeddingInput {
  sourceType: string;
  sourceId: string;
  text: string;
  vector: number[];
  id?: string;
}

export interface NearestNeighbor {
  id: string;
  sourceType: string;
  sourceId: string;
  text: string;
  distance: number;
  similarity: number;
}

function toVectorBlob(vector: number[], label: string): Buffer {
  if (vector.length !== VECTOR_DIMENSIONS) {
    throw new Error(
      `${label} vector has ${vector.length} dimensions, expected ${VECTOR_DIMENSIONS}.`,
    );
  }
  return Buffer.from(new Float32Array(vector).buffer);
}

export function insertEmbedding(input: InsertEmbeddingInput): Embedding {
  const blob = toVectorBlob(input.vector, "input");
  return db.transaction((tx) => {
    const row = tx
      .insert(embeddings)
      .values({
        id: input.id ?? randomUUID(),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        text: input.text,
      })
      .returning()
      .get();
    tx.run(
      sql`INSERT INTO ${sql.identifier(VECTOR_TABLE)} (id, embedding) VALUES (${row.id}, ${blob})`,
    );
    return row;
  });
}

export function searchEmbeddings(
  queryVector: number[],
  options: { k?: number } = {},
): NearestNeighbor[] {
  const blob = toVectorBlob(queryVector, "query");
  const k = Math.max(1, Math.floor(options.k ?? 5));

  const rows = db.all<{
    id: string;
    source_type: string;
    source_id: string;
    text: string;
    distance: number;
  }>(sql`
    SELECT e.id, e.source_type, e.source_id, e.text, v.distance
    FROM ${sql.identifier(VECTOR_TABLE)} AS v
    JOIN ${embeddings} AS e ON e.id = v.id
    WHERE v.embedding MATCH ${blob} AND k = ${k}
    ORDER BY v.distance
  `);

  return rows.map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    text: row.text,
    distance: row.distance,
    similarity: 1 - row.distance,
  }));
}
