/*
 * Acceptance check for MAC-41.
 *
 * Verifies that:
 *   1. sqlite-vec loads into the Drizzle-managed DB and the vec0 virtual
 *      table lives alongside the relational tables in one .db file.
 *   2. insertEmbedding stores source ref + text + vector.
 *   3. searchEmbeddings returns cosine-similarity ranked top-k neighbors,
 *      matching a brute-force cosine ranking computed in JS.
 *
 * Runs against a throwaway database (DATABASE_PATH) so dev data is untouched.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-vector-check-"));
  const dbFile = path.join(dir, "vector-check.db");
  process.env.DATABASE_PATH = dbFile;

  try {
    // Fresh DB via the real migration folder.
    {
      const sqlite = new Database(dbFile);
      migrate(drizzle(sqlite), { migrationsFolder: path.resolve("drizzle") });
      sqlite.close();
    }

    // Import after DATABASE_PATH is set so the singleton picks up the temp DB.
    const { EMBEDDING_DIMENSIONS, embed } = await import(
      "../src/lib/embeddings/index"
    );
    const { VECTOR_DIMENSIONS } = await import("../src/lib/db/vector-schema");

    // 1. Dimension agreement between model output and vec0 table.
    assert.equal(VECTOR_DIMENSIONS, EMBEDDING_DIMENSIONS);
    console.log(`[ok] vec0 table matches ${EMBEDDING_DIMENSIONS}-d embeddings`);

    const { insertEmbedding, searchEmbeddings } = await import(
      "../src/lib/db/vector-search"
    );

    // 2. Vector table lives alongside relational tables in one .db file.
    {
      const sqlite = new Database(dbFile);
      const tables = (
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);

      for (const expected of [
        "sessions",
        "messages",
        "goals",
        "embeddings",
        "embedding_vectors",
      ]) {
        assert.ok(tables.includes(expected), `expected ${expected} to exist`);
      }
      sqlite.close();
    }
    console.log("[ok] vec0 table coexists with relational tables in one .db");

    // 3. Insert vectors alongside source refs + text.
    const docs = [
      ["note-running", "Four runs logged this week. On track for the half marathon goal."],
      ["note-meals", "Meal prep on Sunday: chicken, rice, and vegetables for the week."],
      ["note-sleep", "Struggling with the sleep schedule, staying up past midnight."],
      ["note-training", "Planning the marathon training block around work travel."],
      ["note-budget", "Reviewed monthly budget and cut unused subscriptions."],
    ] as const;

    for (const [sourceId, text] of docs) {
      insertEmbedding({
        sourceType: "note",
        sourceId,
        text,
        vector: await embed(text),
      });
    }
    console.log("[ok] inserted 5 embeddings with source refs");

    // 4. Top-k nearest neighbors ranked by cosine similarity.
    const queryVector = await embed("How is my running training going?", "query");
    const hits = searchEmbeddings(queryVector, { k: 3 });

    assert.equal(hits.length, 3);
    assert.ok(hits.every((h) => h.distance >= 0 && h.distance <= 2));
    assert.ok(hits.every((h) => h.sourceType === "note"));
    assert.ok(
      hits.every((h, i) => i === 0 || hits[i - 1]!.distance <= h.distance),
      "results not sorted by ascending distance",
    );
    console.log("[ok] top-k search returns k sorted results");

    // 5. Ranking agrees with brute-force cosine similarity.
    const docVectors = new Map<string, number[]>();
    for (const [sourceId, text] of docs) {
      docVectors.set(sourceId, await embed(text));
    }
    const expectedTop3 = [...docVectors.entries()]
      .map(([id, v]) => ({ id, sim: cosineSimilarity(queryVector, v) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3)
      .map((x) => x.id);

    assert.deepEqual(
      hits.map((h) => h.sourceId),
      expectedTop3,
      `sqlite-vec ranking ${hits.map((h) => h.sourceId)} != brute force ${expectedTop3}`,
    );
    assert.ok(["note-running", "note-training"].includes(hits[0]!.sourceId));
    console.log("[ok] ranking matches brute-force cosine ordering");

    // 6. Similarity score mirrors cosine similarity of unit vectors.
    const top = hits[0]!;
    const expectedSim = cosineSimilarity(
      queryVector,
      docVectors.get(top.sourceId)!,
    );
    assert.ok(Math.abs(top.similarity - expectedSim) < 0.01);
    console.log("[ok] similarity scores match true cosine similarity");

    // 7. Wrong-dimension vectors are rejected up front.
    assert.throws(
      () => insertEmbedding({ sourceType: "note", sourceId: "bad", text: "x", vector: [1, 2, 3] }),
      /dimensions/,
    );
    assert.throws(() => searchEmbeddings([1, 2, 3]), /dimensions/);
    console.log("[ok] wrong-dimension vectors rejected");

    console.log("\nVector search check passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
