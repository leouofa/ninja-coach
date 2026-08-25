import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const msTimestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New session"),
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
  status: text("status", { enum: ["active", "paused", "completed"] })
    .notNull()
    .default("active"),
  createdAt: msTimestamp("created_at"),
  updatedAt: msTimestamp("updated_at"),
});

export type Session = typeof sessions.$inferSelect;
export type MessageRole = (typeof messages.$inferInsert)["role"];
export type Message = typeof messages.$inferSelect;
export type GoalStatus = (typeof goals.$inferInsert)["status"];
export type Goal = typeof goals.$inferSelect;
