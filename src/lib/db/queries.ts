import { randomUUID } from "node:crypto";

import { asc, desc, eq, ne } from "drizzle-orm";

import { db } from "./index";
import {
  goals,
  messages,
  sessions,
  type Goal,
  type GoalStatus,
  type Message,
  type MessageRole,
  type Session,
  type SessionKind,
} from "./schema";

export function createSession(input: {
  title?: string;
  kind?: SessionKind;
} = {}): Session {
  return db
    .insert(sessions)
    .values({
      id: randomUUID(),
      title: input.title ?? "New session",
      kind: input.kind ?? "open",
    })
    .returning()
    .get();
}

export function getMostRecentSession(exceptId: string): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(ne(sessions.id, exceptId))
    .orderBy(desc(sessions.updatedAt))
    .get();
}

export function getSession(id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function listSessions(): Session[] {
  return db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
}

export interface AddMessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  id?: string;
}

export function addMessage(input: AddMessageInput): Message {
  const now = new Date();
  return db.transaction((tx) => {
    let row: Message | undefined = tx
      .insert(messages)
      .values({
        id: input.id ?? randomUUID(),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        createdAt: now,
      })
      .onConflictDoNothing({ target: messages.id })
      .returning()
      .get();

    if (!row) {
      if (!input.id) {
        throw new Error(`Failed to insert message into session ${input.sessionId}`);
      }
      row = tx.select().from(messages).where(eq(messages.id, input.id)).get();
      if (!row || row.sessionId !== input.sessionId) {
        throw new Error(
          `Message ${input.id} does not belong to session ${input.sessionId}`,
        );
      }
      return row;
    }

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, input.sessionId))
      .run();
    return row;
  });
}

export function getMessage(id: string): Message | undefined {
  return db.select().from(messages).where(eq(messages.id, id)).get();
}

export function getMessages(sessionId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .all();
}

export function createGoal(input: {
  title: string;
  description?: string;
}): Goal {
  return db
    .insert(goals)
    .values({
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
    })
    .returning()
    .get();
}

export function getGoal(id: string): Goal | undefined {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export function listGoals(status?: GoalStatus): Goal[] {
  if (status) {
    return db
      .select()
      .from(goals)
      .where(eq(goals.status, status))
      .orderBy(desc(goals.createdAt))
      .all();
  }
  return db.select().from(goals).orderBy(desc(goals.createdAt)).all();
}

export function updateGoalStatus(id: string, status: GoalStatus): Goal | undefined {
  return db
    .update(goals)
    .set({ status, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning()
    .get();
}
