import "server-only";

import { randomUUID } from "node:crypto";

import { generateText } from "ai";
import { eq } from "drizzle-orm";

import { getModel } from "../ai";
import { db } from "../db";
import { getMessages, listGoals } from "../db/queries";
import {
  goals,
  type Goal,
  type GoalStatus,
} from "../db/schema";
import { VERBATIM_WINDOW } from "../memory";

const EXTRACTOR_SYSTEM =
  "You maintain the user's goal list for an AI life coach. Compare the " +
  "recent conversation against the current goal list and emit ONLY the " +
  "changes the conversation clearly supports, as a strict JSON array. " +
  'Each element is one operation: {"op":"create","title":"...",' +
  '"description":"..."} to add a new goal, {"op":"update","id":"...", ' +
  '"title":"...","description":"...","status":"active|paused|completed|' +
  'dropped"} to refine an existing goal, or {"op":"close","id":"...",' +
  '"status":"completed|dropped"} when a goal was achieved or abandoned. ' +
  "Reference ids from the current goal list for update/close. Never create " +
  "a goal that duplicates an existing one regardless of casing. Emit [] " +
  "when nothing changed. Reply with the JSON array only, no prose.";

const CLOSED_STATUSES: readonly GoalStatus[] = ["completed", "dropped"];
const ALL_STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "completed",
  "dropped",
];

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

export type GoalExtractor = (
  transcript: string,
  currentGoals: Goal[],
) => Promise<GoalOp[]>;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses raw extractor output into validated operations. Malformed entries
 * are skipped; unparseable output yields no ops rather than throwing.
 */
export function parseGoalOps(raw: string): GoalOp[] {
  const json = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    console.error("[goals] extractor returned invalid JSON:", error);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[goals] extractor output was not an array");
    return [];
  }

  const ops: GoalOp[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    if (record.op === "create") {
      const title = clean(record.title);
      if (!title) continue;
      ops.push({ op: "create", title, description: clean(record.description) });
      continue;
    }

    if (record.op === "update") {
      const id = clean(record.id);
      if (!id) continue;
      const status =
        typeof record.status === "string" &&
        (ALL_STATUSES as readonly string[]).includes(record.status)
          ? (record.status as GoalStatus)
          : undefined;
      const description = record.description === null ? null : clean(record.description);
      const op: GoalUpdateOp = {
        op: "update",
        id,
        ...(clean(record.title) ? { title: clean(record.title)! } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status ? { status } : {}),
      };
      if (op.title || op.description !== undefined || op.status) {
        ops.push(op);
      }
      continue;
    }

    if (record.op === "close") {
      const id = clean(record.id);
      const status = clean(record.status);
      if (!id) continue;
      if (status && (CLOSED_STATUSES as readonly string[]).includes(status)) {
        ops.push({ op: "close", id, status: status as "completed" | "dropped" });
      }
    }
  }
  return ops;
}

async function defaultExtract(
  transcript: string,
  currentGoals: Goal[],
): Promise<GoalOp[]> {
  const { text } = await generateText({
    model: getModel(),
    system: EXTRACTOR_SYSTEM,
    prompt:
      `Current goals:\n${JSON.stringify(currentGoals, null, 2)}\n\n` +
      `Recent conversation:\n${transcript}`,
  });
  return parseGoalOps(text);
}

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

/**
 * Runs goal extraction over the recent conversation and applies the result.
 * The extractor is injectable for deterministic testing.
 */
export async function syncGoalsFromConversation(
  sessionId: string,
  options: { extract?: GoalExtractor } = {},
): Promise<Goal[]> {
  const history = getMessages(sessionId);
  if (history.length === 0) {
    return [];
  }

  const transcript = history
    .slice(-VERBATIM_WINDOW)
    .map((m) => `${m.role === "assistant" ? "Coach" : "User"}: ${m.content}`)
    .join("\n");

  const extract = options.extract ?? defaultExtract;
  const ops = await extract(transcript, listGoals());
  return applyGoalOps(ops);
}
