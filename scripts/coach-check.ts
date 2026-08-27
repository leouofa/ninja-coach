/*
 * Acceptance check for MAC-43.
 *
 * Verifies that:
 *   1. Sessions carry a kind ("open" default, "checkin" opt-in).
 *   2. Every composed prompt carries the coach persona (direct, supportive,
 *      asks questions, raises goals/progress unprompted).
 *   3. Only check-in sessions get the weekly structure and a
 *      "Since last session" recap grounded in the most recent prior session
 *      (its summary when compacted, else its latest messages).
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
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-coach-check-"));
  const dbFile = path.join(dir, "coach-check.db");
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
      COACH_PERSONA,
      CHECKIN_STRUCTURE,
    } = await import("../src/lib/coach/persona");
    const { buildContext } = await import("../src/lib/memory");
    const {
      addMessage,
      createSession,
      getMostRecentSession,
    } = await import("../src/lib/db/queries");

    // 1. Session kinds persist; "open" is the default.
    const openSession = createSession();
    assert.equal(openSession.kind, "open");
    const checkinSession = createSession({
      kind: "checkin",
      title: "Weekly check-in",
    });
    assert.equal(checkinSession.kind, "checkin");

    // 2. Check-in structure injected; no recap while nothing has history.
    const soloCtx = await buildContext(checkinSession.id);
    assert.ok(soloCtx.system.includes(CHECKIN_STRUCTURE));
    assert.ok(!soloCtx.system.includes("Since last session"));
    console.log("[ok] check-in structure injected, no empty recap");

    // getMostRecentSession excludes the current one and picks latest activity.
    addMessage({
      sessionId: checkinSession.id,
      role: "user",
      content: "kickoff",
    });
    assert.equal(getMostRecentSession(checkinSession.id)?.id, openSession.id);
    console.log("[ok] session kinds persist, recent-session lookup works");

    // 2. Persona is always present; structure/recap are check-in-only.
    addMessage({
      sessionId: openSession.id,
      role: "user",
      content: "Just checking in about my week.",
    });
    const openCtx = await buildContext(openSession.id);
    assert.ok(openCtx.system.startsWith(COACH_PERSONA));
    assert.ok(/ask good questions/i.test(openCtx.system));
    assert.ok(/unprompted/i.test(openCtx.system));
    assert.ok(!openCtx.system.includes(CHECKIN_STRUCTURE));
    assert.ok(!openCtx.system.includes("Since last session"));
    assert.ok(
      /search_memory/i.test(openCtx.system),
      "persona should mention search_memory tool",
    );
    assert.ok(
      /list_goals/i.test(openCtx.system),
      "persona should mention list_goals tool",
    );
    console.log("[ok] open sessions get persona with tool hints, no check-in flow");

    // 3. Recap grounded in the most recent prior session's messages.
    const recapCheckin = createSession({ kind: "checkin", title: "This week" });
    const prior = createSession({ title: "Last week" });
    addMessage({
      sessionId: prior.id,
      role: "user",
      content: "I committed to running three times and sleeping by 11pm.",
    });
    addMessage({
      sessionId: prior.id,
      role: "assistant",
      content: "Good plan. Report back next week.",
    });

    const recapCtx = await buildContext(recapCheckin.id);
    assert.ok(recapCtx.system.includes("Since last session"));
    assert.ok(
      recapCtx.system.includes("running three times"),
      "recap missing prior-session content",
    );
    console.log("[ok] recap grounds progress in most recent session");

    // 5. Compacted prior sessions recap via their summary, not raw messages.
    const { db } = await import("../src/lib/db");
    const { randomUUID } = await import("node:crypto");
    const { summaries } = await import("../src/lib/db/schema");
    db.insert(summaries)
      .values({
        id: randomUUID(),
        sessionId: prior.id,
        content: "SUMMARY-RECAP: user is marathon training.",
        coveredMessages: 2,
      })
      .run();

    // Touch prior so it's the most recent session for summaryCheckin's recap.
    addMessage({
      sessionId: prior.id,
      role: "user",
      content: "Quick follow-up.",
    });

    const summaryCheckin = createSession({
      kind: "checkin",
      title: "Next week",
    });
    const summaryCtx = await buildContext(summaryCheckin.id);
    assert.ok(summaryCtx.system.includes("SUMMARY-RECAP"));
    assert.ok(
      !summaryCtx.system.includes("Report back next week."),
      "recap used raw transcript despite existing summary",
    );
    console.log("[ok] recap prefers compacted summary over transcript");

    // 6. Structure covers the three-part weekly flow.
    for (const part of [
      "current focus",
      "active goals",
      "wins, misses",
    ] as const) {
      assert.ok(
        CHECKIN_STRUCTURE.toLowerCase().includes(part),
        `structure missing "${part}"`,
      );
    }
    assert.match(CHECKIN_STRUCTURE, /one question per message/i);
    console.log("[ok] check-in structure covers now/goals/progress");

    console.log("\nCoach check passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
