/*
 * Acceptance check for MAC-42.
 *
 * Verifies that:
 *   1. rememberExchange stores each user/coach exchange as one document.
 *   2. The verbatim window stays bounded as history grows.
 *   3. maybeSummarizeSession compacts history older than the window,
 *      upserts the summary, and the composed prompt includes it.
 *
 * Runs against a throwaway database (DATABASE_PATH) and is fully
 * deterministic: embeddings are local, the LLM summarizer is stubbed.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

async function exchangeCount(dbFile: string): Promise<number> {
  const raw = new Database(dbFile, { readonly: true });
  try {
    const row = raw
      .prepare("SELECT COUNT(*) AS n FROM embeddings WHERE source_type = 'exchange'")
      .get() as { n: number };
    return row.n;
  } finally {
    raw.close();
  }
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-memory-check-"));
  const dbFile = path.join(dir, "memory-check.db");
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
      SUMMARIZE_CHUNK,
      VERBATIM_WINDOW,
      buildContext,
      maybeSummarizeSession,
      rememberExchange,
    } = await import("../src/lib/memory");
    const { addMessage, createSession } = await import(
      "../src/lib/db/queries"
    );

    // 1. Exchanges stored as single documents.
    const sessionA = createSession({ title: "Training talk" });
    const aExchanges = [
      [
        "I'm training for a half marathon in October, running four times a week.",
        "Great baseline. Keep the long runs progressive and log how they feel.",
      ],
      [
        "Sleep has been rough lately, I stay up past midnight most nights.",
        "Let's anchor your bedtime. Move screens out of the bedroom this week.",
      ],
      [
        "I do my meal prep on Sundays: chicken, rice, and vegetables.",
        "Solid routine. Add a post-run carb source on long run days.",
      ],
    ] as const;
    for (const [userText, assistantText] of aExchanges) {
      await rememberExchange({
        userMessageId: `a-${userText.slice(0, 12)}`,
        userText,
        assistantText,
      });
    }
    assert.equal(await exchangeCount(dbFile), aExchanges.length);
    console.log("[ok] exchanges embedded + stored");

    // Empty assistant text is skipped.
    await rememberExchange({
      userMessageId: "a-empty",
      userText: "hello?",
      assistantText: "",
    });
    assert.equal(await exchangeCount(dbFile), aExchanges.length);
    console.log("[ok] incomplete exchanges skipped");

    // 2. Verbatim window stays bounded.
    const sessionB = createSession({ title: "New chat" });
    for (let i = 0; i < VERBATIM_WINDOW + 4; i++) {
      addMessage({
        sessionId: sessionB.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Filler message number ${i}.`,
        id: `b-filler-${i}`,
      });
    }
    addMessage({
      sessionId: sessionB.id,
      role: "user",
      content: "Last message.",
      id: "b-last",
    });

    const bounded = await buildContext(sessionB.id);
    assert.ok(bounded.window.length <= VERBATIM_WINDOW);
    assert.ok(bounded.window.length >= 1);
    assert.equal(bounded.window[bounded.window.length - 1]?.role, "user");
    console.log("[ok] window stays bounded as history grows");

    // 3. Summarization thresholds (stubbed summarizer).
    let summarizeCalls = 0;
    const stub = async (transcript: string) => {
      summarizeCalls++;
      return `SUMMARY-STUB(${summarizeCalls}) seen:\n${transcript.split("\n").length} lines`;
    };

    // Below threshold: nothing to compact yet.
    assert.equal(await maybeSummarizeSession(sessionA.id, { summarize: stub }), undefined);
    assert.equal(summarizeCalls, 0);

    // Push A past the threshold: VERBATIM_WINDOW + SUMMARIZE_CHUNK messages.
    const totalMessages = VERBATIM_WINDOW + SUMMARIZE_CHUNK;
    while (
      (
        new Database(dbFile, { readonly: true })
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?")
          .get(sessionA.id) as { n: number }
      ).n < totalMessages
    ) {
      addMessage({
        sessionId: sessionA.id,
        role: "user",
        content: "Another training update for the log.",
      });
      addMessage({
        sessionId: sessionA.id,
        role: "assistant",
        content: "Noted. Stay consistent.",
      });
    }

    const firstSummary = await maybeSummarizeSession(sessionA.id, {
      summarize: stub,
    });
    assert.ok(firstSummary);
    assert.equal(summarizeCalls, 1);
    assert.equal(firstSummary!.coveredMessages, totalMessages - VERBATIM_WINDOW);
    assert.match(firstSummary!.content, /SUMMARY-STUB\(1\)/);
    console.log("[ok] summary created once uncovered messages pile up");

    // No re-summarization until another chunk accumulates.
    await maybeSummarizeSession(sessionA.id, { summarize: stub });
    assert.equal(summarizeCalls, 1);

    // After SUMMARIZE_CHUNK more messages, the summary refreshes (upsert).
    for (let i = 0; i < SUMMARIZE_CHUNK / 2; i++) {
      addMessage({ sessionId: sessionA.id, role: "user", content: `Extra update ${i}.` });
      addMessage({ sessionId: sessionA.id, role: "assistant", content: "Heard." });
    }
    const refreshed = await maybeSummarizeSession(sessionA.id, {
      summarize: stub,
    });
    assert.equal(summarizeCalls, 2);
    assert.match(refreshed!.content, /SUMMARY-STUB\(2\)/);
    assert.equal(refreshed!.id, firstSummary!.id);
    assert.equal(
      refreshed!.coveredMessages,
      totalMessages + SUMMARIZE_CHUNK - VERBATIM_WINDOW,
    );
    console.log("[ok] summary upserts lazily per chunk");

    // 4. Composed prompt includes the compacted summary.
    addMessage({
      sessionId: sessionA.id,
      role: "user",
      content: "What were we saying about sleep?",
    });
    const withSummary = await buildContext(sessionA.id);
    assert.ok(withSummary.system.includes("SUMMARY-STUB(2)"));
    assert.ok(withSummary.system.includes("Earlier in this conversation"));
    assert.ok(withSummary.window.length <= VERBATIM_WINDOW);
    assert.ok(withSummary.window.length >= 1);
    console.log("[ok] system prompt carries compacted summary");

    console.log("\nMemory check passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
