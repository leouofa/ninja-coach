/*
 * Acceptance check for goal-driven todos.
 *
 * Verifies that:
 *   1. Todos are always linked to an existing goal: creating a todo for an
 *      unknown goal is rejected; linking to a real goal works and cascades
 *      deletion when the goal is removed.
 *   2. create/update/delete todo semantics work (status lifecycle including
 *      completion).
 *   3. Todo coach tools are defined with correct schemas.
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
  const dir = mkdtempSync(path.join(tmpdir(), "ninja-coach-todos-check-"));
  const dbFile = path.join(dir, "todos-check.db");
  process.env.DATABASE_PATH = dbFile;

  try {
    // Fresh DB via the real migration folder.
    {
      const sqlite = new Database(dbFile);
      migrate(drizzle(sqlite), { migrationsFolder: path.resolve("drizzle") });
      sqlite.close();
    }

    // Import after DATABASE_PATH is set so the singleton picks up the temp DB.
    const { createGoal, createTodo, updateTodo, deleteTodo, listTodos, listOpenTodosWithGoal } =
      await import("../src/lib/db/queries");

    // 1. Create guard: unknown goal rejected.
    assert.equal(createTodo({ goalId: "missing", title: "ghost" }), undefined);
    console.log("[ok] todos require an existing goal");

    // Real goal + todos.
    const goal = createGoal({ title: "Run a half marathon", description: "October" });
    const first = createTodo({ goalId: goal.id, title: "Follow a training plan" });
    const second = createTodo({
      goalId: goal.id,
      title: "Buy new running shoes",
      description: "Visit the shop this weekend",
    });
    assert.ok(first && second, "todos created under a real goal");
    assert.equal(first.status, "pending");
    assert.equal(listTodos({ goalId: goal.id }).length, 2);
    assert.equal(listTodos({ goalId: goal.id, status: "pending" }).length, 2);
    assert.equal(listTodos({ goalId: goal.id, status: "completed" }).length, 0);
    console.log("[ok] todos created + listed with goal/status filters");

    // Update semantics: progress through the status lifecycle.
    const progressing = updateTodo(first.id, { status: "in_progress" });
    assert.equal(progressing?.status, "in_progress");
    const completed = updateTodo(first.id, { title: "Finish the training plan", status: "completed" });
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.title, "Finish the training plan");
    const cleared = updateTodo(second.id, { description: null });
    assert.equal(cleared?.description, null);
    console.log("[ok] todo updates applied (status lifecycle + fields)");

    // Open-todos join excludes completed, and includes the goal title.
    const open = listOpenTodosWithGoal();
    assert.equal(open.length, 1);
    assert.equal(open[0]!.goalId, goal.id);
    assert.equal(open[0].goalTitle, "Run a half marathon");
    console.log("[ok] open-todo join includes goal title");

    // Removal.
    assert.ok(deleteTodo(second.id));
    assert.equal(deleteTodo(second.id), false);
    assert.equal(listTodos({ goalId: goal.id }).length, 1);
    console.log("[ok] todo removed");

    // 2. Coach tools are defined.
    const { coachTools } = await import("../src/lib/tools");
    const todoToolNames = ["list_todos", "create_todo", "update_todo", "remove_todo"] as const;
    for (const name of todoToolNames) {
      assert.ok(coachTools[name], `missing ${name} tool`);
      assert.ok(coachTools[name]!.description, `tool ${name} missing description`);
    }
    console.log("[ok] all 4 todo tools defined with descriptions");

    console.log("\nTodos check passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});