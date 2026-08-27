import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const msTimestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New session"),
  kind: text("kind", { enum: ["open", "checkin"] })
    .notNull()
    .default("open"),
  createdAt: msTimestamp("created_at"),
  updatedAt: msTimestamp("updated_at"),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    createdAt: msTimestamp("created_at"),
  },
  (table) => [index("messages_session_id_idx").on(table.sessionId)],
);

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "paused", "completed", "dropped"] })
    .notNull()
    .default("active"),
  createdAt: msTimestamp("created_at"),
  updatedAt: msTimestamp("updated_at"),
});

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "in_progress", "completed"],
    })
      .notNull()
      .default("pending"),
    createdAt: msTimestamp("created_at"),
    updatedAt: msTimestamp("updated_at"),
  },
  (table) => [index("todos_goal_id_idx").on(table.goalId)],
);

export const embeddings = sqliteTable(
  "embeddings",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    text: text("text").notNull(),
    createdAt: msTimestamp("created_at"),
  },
  (table) => [
    index("embeddings_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export const summaries = sqliteTable("summaries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  coveredMessages: integer("covered_messages").notNull(),
  createdAt: msTimestamp("created_at"),
  updatedAt: msTimestamp("updated_at"),
});

export type Session = typeof sessions.$inferSelect;
export type SessionKind = (typeof sessions.$inferInsert)["kind"];
export type MessageRole = (typeof messages.$inferInsert)["role"];
export type Message = typeof messages.$inferSelect;
export type GoalStatus = (typeof goals.$inferInsert)["status"];
export type Goal = typeof goals.$inferSelect;
export type TodoStatus = (typeof todos.$inferInsert)["status"];
export type Todo = typeof todos.$inferSelect;
export type Embedding = typeof embeddings.$inferSelect;
export type Summary = typeof summaries.$inferSelect;
