/*
 * Acceptance check for MAC-37.
 *
 * Verifies that:
 *   1. Drizzle migrations create a fresh .db file containing every table.
 *   2. Insert/query round-trips work through the real query helpers.
 *
 * Runs against a throwaway database (DATABASE_PATH) so dev data is untouched.
 * The react-server condition satisfies the `server-only` guard used by the DAL.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-roundtrip-"));
  const dbFile = path.join(dir, "roundtrip.db");
  process.env.DATABASE_PATH = dbFile;

  try {
    // 1. Migrations must create the .db file with all tables.
    {
      const sqlite = new Database(dbFile);
      migrate(drizzle(sqlite), { migrationsFolder: path.resolve("drizzle") });

      const tables = (
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);

      for (const expected of ["sessions", "messages", "goals"]) {
        assert.ok(tables.includes(expected), `expected table ${expected} to exist`);
      }
      sqlite.close();
      console.log("[ok] migrations created .db with all tables");
    }

    // Import after DATABASE_PATH is set so the singleton picks up the temp DB.
    const {
      addMessage,
      createGoal,
      createSession,
      getGoal,
      getMessage,
      getSession,
      getMessages,
      listGoals,
      listSessions,
      updateGoalStatus,
    } = await import("../src/lib/db/queries");

    // 2. Session + messages round-trip.
    const session = createSession({ title: "Weekly check-in" });
    assert.equal(session.title, "Weekly check-in");

    addMessage({
      sessionId: session.id,
      role: "user",
      content: "Where am I on the running goal?",
    });
    const reply = addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "Four runs logged this week. On track.",
    });

    assert.ok(getSession(session.id));
    assert.equal(listSessions().length, 1);
    assert.equal(getMessage(reply.id)?.content, reply.content);

    const history = getMessages(session.id);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, "user");
    console.log("[ok] sessions + messages round-trip");

    // 3. Goals round-trip.
    const goal = createGoal({
      title: "Run a half marathon",
      description: "Under 2 hours",
    });
    assert.equal(goal.status, "active");
    assert.ok(getGoal(goal.id));
    assert.equal(listGoals().length, 1);
    assert.equal(listGoals("active").length, 1);

    const paused = updateGoalStatus(goal.id, "paused");
    assert.equal(paused?.status, "paused");
    assert.equal(listGoals("active").length, 0);
    assert.equal(listGoals("paused")?.length, 1);
    console.log("[ok] goals round-trip");

    console.log("\nRound-trip passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
