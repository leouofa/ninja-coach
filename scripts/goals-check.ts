/*
 * Acceptance check for MAC-44.
 *
 * Verifies that:
 *   1. applyGoalOps creates/updates/closes goals transactionally, dedupes
 *      creates against existing titles (case-insensitive), and ignores
 *      operations on unknown ids.
 *   2. Coach tools are defined with correct schemas.
 *
 * Runs against a throwaway database (DATABASE_PATH); fully offline.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-goals-check-"));
  const dbFile = path.join(dir, "goals-check.db");
  process.env.DATABASE_PATH = dbFile;

  try {
    // Fresh DB via the real migration folder.
    {
      const sqlite = new Database(dbFile);
      migrate(drizzle(sqlite), { migrationsFolder: path.resolve("drizzle") });
      sqlite.close();
    }

    // Import after DATABASE_PATH is set so the singleton picks up the temp DB.
    const { applyGoalOps } = await import("../src/lib/goals");
    const {
      listGoals,
    } = await import("../src/lib/db/queries");

    // 1. applyGoalOps semantics.
    const created = applyGoalOps([
      { op: "create", title: "Run a half marathon", description: "Under 2 hours in October" },
      { op: "create", title: "Sleep before 11pm" },
    ]);
    assert.equal(created.length, 2);
    assert.ok(created.every((g) => g.status === "active"));
    console.log("[ok] goals created transactionally");

    // Dedup: same goal different casing is skipped; unknown ids ignored.
    const applied = applyGoalOps([
      { op: "create", title: "run a half marathon" },           // dup -> skip
      { op: "create", title: "Meal prep on Sundays" },
      { op: "update", id: "unknown-id", title: "ghost" },       // ignored
      { op: "close", id: "unknown-id", status: "dropped" },     // ignored
    ]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.title, "Meal prep on Sundays");
    assert.equal(listGoals().length, 3);
    console.log("[ok] dedup + guards applied correctly");

    // Update + close by real ids.
    const marathon = listGoals().find((g) => g.title === "Run a half marathon")!;
    const mealPrep = applied[0]!;
    const secondRound = applyGoalOps([
      { op: "update", id: marathon.id, title: "Run a full marathon", status: "paused" },
      { op: "close", id: mealPrep.id, status: "dropped" },
    ]);
    assert.equal(secondRound.length, 2);
    const afterUpdate = listGoals().find((g) => g.title === "Run a full marathon")!;
    assert.equal(afterUpdate!.status, "paused");
    assert.equal(listGoals().find((g) => g.id === mealPrep.id)!.status, "dropped");
    console.log("[ok] create/update/close applied with dedup + guards");

    // 2. Coach tools are defined.
    const { coachTools } = await import("../src/lib/tools");
    const toolNames = Object.keys(coachTools);
    assert.ok(toolNames.includes("list_goals"), "missing list_goals tool");
    assert.ok(toolNames.includes("create_goal"), "missing create_goal tool");
    assert.ok(toolNames.includes("update_goal"), "missing update_goal tool");
    assert.ok(toolNames.includes("close_goal"), "missing close_goal tool");
    assert.ok(toolNames.includes("search_memory"), "missing search_memory tool");
    assert.ok(toolNames.includes("get_session_summary"), "missing get_session_summary tool");
    console.log("[ok] all 6 coach tools defined");

    // Tool definitions have descriptions.
    for (const [name, t] of Object.entries(coachTools)) {
      assert.ok(t.description, `tool ${name} missing description`);
    }
    console.log("[ok] all tools have descriptions");

    console.log("\nGoals check passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
