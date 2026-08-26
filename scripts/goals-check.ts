/*
 * Acceptance check for MAC-44.
 *
 * Verifies that:
 *   1. Active goals are injected into the coach context of every session;
 *      non-active goals and empty lists are omitted.
 *   2. parseGoalOps validates extractor output: malformed JSON, unknown
 *      ops, missing fields, and invalid statuses are rejected.
 *   3. applyGoalOps creates/updates/closes goals transactionally, dedupes
 *      creates against existing titles (case-insensitive), and ignores
 *      operations on unknown ids.
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
    const {
      applyGoalOps,
      parseGoalOps,
      syncGoalsFromConversation,
    } = await import("../src/lib/goals");
    const { buildContext } = await import("../src/lib/memory");
    const {
      createSession,
      listGoals,
      updateGoalStatus,
    } = await import("../src/lib/db/queries");

    // 1. Active goals injected into every session's context; omitted when none.
    const sessionA = createSession({ title: "A" });
    const noGoalsCtx = await buildContext(sessionA.id);
    assert.ok(!noGoalsCtx.system.includes("Active goals"));
    console.log("[ok] empty goal list omitted from context");

    const created = applyGoalOps([
      { op: "create", title: "Run a half marathon", description: "Under 2 hours in October" },
      { op: "create", title: "Sleep before 11pm" },
    ]);
    assert.equal(created.length, 2);
    assert.ok(created.every((g) => g.status === "active"));

    const sessionB = createSession({ title: "B" });
    const ctx = await buildContext(sessionB.id);
    assert.ok(ctx.system.includes("Active goals"));
    assert.ok(ctx.system.includes("Run a half marathon - Under 2 hours in October"));
    assert.ok(ctx.system.includes("Sleep before 11pm"));
    console.log("[ok] active goals injected across sessions");

    // Non-active goals drop out of the injection.
    const sleepGoal = listGoals().find((g) => g.title === "Sleep before 11pm")!;
    updateGoalStatus(sleepGoal.id, "completed");
    const ctxAfterClose = await buildContext(sessionB.id);
    assert.ok(ctxAfterClose.system.includes("Run a half marathon"));
    assert.ok(!ctxAfterClose.system.includes("Sleep before 11pm"));
    console.log("[ok] completed goals leave the context");

    // 2. parseGoalOps validation.
    assert.deepEqual(parseGoalOps("not json at all"), []);
    assert.deepEqual(parseGoalOps('{"op":"create"}'), []);
    assert.deepEqual(parseGoalOps('[{"op":"frobnicate","id":"x"}]'), []);

    const parsed = parseGoalOps(
      '```json\n' +
        JSON.stringify([
          { op: "create", title: "Read 20 books", description: "This year" },
          { op: "update", id: "g-1", status: "paused" },
          { op: "update", id: "g-2", status: "exploded" },   // invalid status
          { op: "close", id: "g-3", status: "dropped" },
          { op: "close", id: "g-4", status: "achieved" },    // not allowed
          { op: "create", title: "   " },                    // blank title
          { op: "update", id: "" },                          // missing id
        ]) +
        "\n```",
    );
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed[0], {
      op: "create",
      title: "Read 20 books",
      description: "This year",
    });
    assert.deepEqual(parsed[1], { op: "update", id: "g-1", status: "paused" });
    assert.deepEqual(parsed[2], { op: "close", id: "g-3", status: "dropped" });
    console.log("[ok] extractor output validated and clamped");

    // 3. applyGoalOps semantics.
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

    // 4. syncGoalsFromConversation wires transcript -> extractor -> apply.
    const {
      addMessage,
    } = await import("../src/lib/db/queries");
    addMessage({
      sessionId: sessionA.id,
      role: "user",
      content: "I also want to build a weekly check-in ritual every Sunday.",
    });
    addMessage({
      sessionId: sessionA.id,
      role: "assistant",
      content: "Good habit. Let's hold you to it.",
    });

    let capturedTranscript = "";
    let capturedCurrent: number | undefined;
    const synced = await syncGoalsFromConversation(sessionA.id, {
      extract: async (transcript, currentGoals) => {
        capturedTranscript = transcript;
        capturedCurrent = currentGoals.length;
        return [{ op: "create", title: "Weekly check-in ritual" }];
      },
    });
    assert.match(capturedTranscript, /User:/);
    assert.equal(capturedCurrent, listGoals().length - 1);
    assert.equal(synced.length, 1);
    assert.equal(synced[0]!.title, "Weekly check-in ritual");

    // Empty conversation extracts nothing.
    const fresh = createSession({ title: "empty" });
    assert.deepEqual(await syncGoalsFromConversation(fresh.id, {
      extract: async () => {
        throw new Error("should not be called");
      },
    }), []);
    console.log("[ok] sync pipeline wired end to end");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
