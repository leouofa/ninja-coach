import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { listGoals } from "../db/queries";
import {
  goals,
  type Goal,
  type GoalStatus,
} from "../db/schema";

export interface GoalCreateOp {
  op: "create";
  title: string;
  description?: string;
}

export interface GoalUpdateOp {
  op: "update";
  id: string;
  title?: string;
  description?: string | null;
  status?: GoalStatus;
}

export interface GoalCloseOp {
  op: "close";
  id: string;
  status: "completed" | "dropped";
}

export type GoalOp = GoalCreateOp | GoalUpdateOp | GoalCloseOp;

function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Applies validated operations. Creates are deduped against existing goal
 * titles (case-insensitive) and against each other; updates/closes for
 * unknown ids are ignored.
 */
export function applyGoalOps(ops: GoalOp[]): Goal[] {
  const existing = new Set(listGoals().map((g) => titleKey(g.title)));
  const existingIds = new Set(listGoals().map((g) => g.id));
  const applied: Goal[] = [];

  return db.transaction((tx) => {
    for (const op of ops) {
      if (op.op === "create") {
        const key = titleKey(op.title);
        if (existing.has(key)) continue;
        existing.add(key);
        applied.push(
          tx
            .insert(goals)
            .values({
              id: randomUUID(),
              title: op.title,
              description: op.description ?? null,
              status: "active",
              updatedAt: new Date(),
            })
            .returning()
            .get(),
        );
        continue;
      }

      if (op.op === "update") {
        if (!existingIds.has(op.id)) continue;
        const row = tx
          .update(goals)
          .set({
            ...(op.title ? { title: op.title } : {}),
            ...(op.description !== undefined ? { description: op.description } : {}),
            ...(op.status ? { status: op.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(goals.id, op.id))
          .returning()
          .get();
        if (row) {
          existing.add(titleKey(row.title));
          applied.push(row);
        }
        continue;
      }

      if (!existingIds.has(op.id)) continue;
      const row = tx
        .update(goals)
        .set({ status: op.status, updatedAt: new Date() })
        .where(eq(goals.id, op.id))
        .returning()
        .get();
      if (row) applied.push(row);
    }
    return applied;
  });
}
