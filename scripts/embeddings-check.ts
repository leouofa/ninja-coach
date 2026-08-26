/*
 * Acceptance check for MAC-40.
 *
 * Verifies that:
 *   1. `embed()` returns deterministic 768-dimensional vectors
 *      (nomic-embed-text-v1.5 via @huggingface/transformers).
 *   2. The model is cached under .cache/huggingface and can be loaded
 *      fully offline after the first-run download.
 *
 * First run downloads the fp32 model (~550MB); later runs are offline.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

async function main() {
  // Import after react-server condition is active so `server-only` passes.
  const { EMBEDDING_DIMENSIONS, embed } = await import(
    "../src/lib/embeddings/index"
  );

  const offline = !!process.env.HF_HUB_OFFLINE;
  if (offline) {
    console.log("(offline mode: model must load from cache only)");
  } else {
    console.log(
      "Embedding sample text (first ever run downloads ~550MB to .cache/huggingface)...",
    );
  }

  const sample =
    "Four runs logged this week. On track for the half marathon goal.";

  // 1. Dimensionality + sanity.
  const vector = await embed(sample);
  assert.equal(vector.length, EMBEDDING_DIMENSIONS);
  assert.ok(vector.every((v) => Number.isFinite(v)));
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-5, `expected unit norm, got ${norm}`);
  console.log(`[ok] ${EMBEDDING_DIMENSIONS}-d normalized vector`);

  // 2. Determinism across calls.
  const again = await embed(sample);
  assert.equal(again.length, vector.length);
  const drift = Math.max(...vector.map((v, i) => Math.abs(v - again[i])));
  assert.ok(drift < 1e-6, `non-deterministic embedding, drift ${drift}`);
  console.log("[ok] deterministic across repeated calls");

  // 3. Distinct inputs diverge; task prefixes matter.
  const other = await embed("Completely unrelated note about sleep.");
  assert.notDeepStrictEqual(other.map((v) => v.toFixed(6)), vector.map((v) => v.toFixed(6)));

  const asQuery = await embed(sample, "query");
  const queryDrift = Math.max(
    ...vector.map((v, i) => Math.abs(v - asQuery[i])),
  );
  assert.ok(queryDrift > 1e-4, "document/query prefixes produced no difference");
  console.log("[ok] distinct inputs and task prefixes diverge");

  // 4. Empty input rejected.
  await assert.rejects(() => embed("   "), /empty/);
  console.log("[ok] empty input rejected");

  // 5. Model cache exists.
  const cacheDir = path.join(process.cwd(), ".cache", "huggingface");
  assert.ok(existsSync(cacheDir) && readdirSync(cacheDir).length > 0);
  console.log("[ok] model cached under .cache/huggingface");

  // 6. Full suite re-run with remote access disabled must pass from cache alone.
  if (!offline) {
    console.log("Re-running full check offline (HF_HUB_OFFLINE=1)...");
    const rerun = spawnSync("npm", ["run", "--silent", "embeddings:check"], {
      env: { ...process.env, HF_HUB_OFFLINE: "1" },
      stdio: "inherit",
    });
    assert.equal(rerun.status, 0, "offline re-run failed");
    console.log("[ok] full check passes fully offline from cache");
  }

  console.log("\nEmbeddings check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
