import "server-only";

import { tool, zodSchema } from "ai";
import { z } from "zod/v4";

import { embed } from "../embeddings";
import {
  getMessages,
  getMostRecentSession,
  getSession,
  listGoals,
  createGoal,
  updateGoalStatus,
  getGoal,
  createTodo,
  getTodo,
  listTodos,
  updateTodo,
  deleteTodo,
} from "../db/queries";
import { getSummary } from "../memory";
import { searchEmbeddings } from "../db/vector-search";

const MAX_RESULT_CHARS = 480;

function clip(text: string, max = MAX_RESULT_CHARS): string {
  return text.length <= max ? text.slice(0, max - 1) + "…" : text;
}

function formatTranscript(
  messages: Array<{ role: string; content: string }>,
): string {
  return messages
    .map((m) => `${m.role === "assistant" ? "Coach" : "User"}: ${m.content}`)
    .join("\n");
}

/**
 * Tool input schemas, exported so acceptance checks can assert that optional
 * fields tolerate `null`. Optional fields are `.nullish()` — models commonly
 * emit `null` for unset optionals, and validation must not reject that.
 */
export const coachToolInputSchemas = {
  list_goals: z.object({
    status: z
      .enum(["active", "paused", "completed", "dropped"])
      .nullish()
      .describe("Filter by goal status. Omit for all goals."),
  }),

  create_goal: z.object({
    title: z.string().describe("Goal title"),
    description: z
      .string()
      .nullish()
      .describe("Optional goal description or details"),
  }),

  update_goal: z.object({
    id: z.string().describe("Goal id"),
    title: z.string().nullish().describe("New title"),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("New description (null to clear)"),
    status: z
      .enum(["active", "paused", "completed", "dropped"])
      .nullish()
      .describe("New status"),
  }),

  close_goal: z.object({
    id: z.string().describe("Goal id"),
    status: z
      .enum(["completed", "dropped"])
      .describe("Final status: completed or dropped"),
  }),

  search_memory: z.object({
    query: z
      .string()
      .describe("Search query — typically the user's message or topic"),
    k: z.number().nullish().describe("Number of results to return (default 4)"),
  }),

  get_session_summary: z.object({
    sessionId: z
      .string()
      .nullish()
      .describe(
        "Session id to summarize. Omit for the most recent prior session.",
      ),
  }),

  list_todos: z.object({
    goalId: z.string().nullish().describe("Filter by goal id"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .nullish()
      .describe("Filter by todo status. Omit for all todos."),
  }),

  create_todo: z.object({
    goalId: z.string().describe("Id of the goal this todo belongs to"),
    title: z.string().describe("Todo title"),
    description: z
      .string()
      .nullish()
      .describe("Optional todo description or details"),
  }),

  update_todo: z.object({
    id: z.string().describe("Todo id"),
    title: z.string().nullish().describe("New title"),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("New description (null to clear)"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .nullish()
      .describe("New status"),
  }),

  remove_todo: z.object({
    id: z.string().describe("Todo id"),
  }),
} as const;

export const coachTools = {
  list_goals: tool({
    description:
      "Fetch the user's current goals. Returns all goals unless a status filter is specified.",
    inputSchema: zodSchema(coachToolInputSchemas.list_goals),
    execute: async (input) => {
      const goals = listGoals(input.status ?? undefined);
      if (goals.length === 0) {
        return "No goals found.";
      }
      return goals
        .map(
          (g) =>
            `- [${g.status}] ${g.id}: ${g.title}${g.description ? ` — ${g.description}` : ""}`,
        )
        .join("\n");
    },
  }),

  create_goal: tool({
    description:
      "Create a new goal for the user. Use when they commit to something new.",
    inputSchema: zodSchema(coachToolInputSchemas.create_goal),
    execute: async (input) => {
      const goal = createGoal({
        title: input.title,
        description: input.description ?? undefined,
      });
      return `Created goal: ${goal.title} (id: ${goal.id})`;
    },
  }),

  update_goal: tool({
    description:
      "Update an existing goal's title, description, or status. Use when the user revises a goal.",
    inputSchema: zodSchema(coachToolInputSchemas.update_goal),
    execute: async (input) => {
      const existing = getGoal(input.id);
      if (!existing) {
        return `Goal ${input.id} not found.`;
      }
      const updated = updateGoalStatus(
        input.id,
        input.status ?? existing.status,
      );
      if (!updated) {
        return `Failed to update goal ${input.id}.`;
      }
      return `Updated goal: ${updated.title} (status: ${updated.status})`;
    },
  }),

  close_goal: tool({
    description:
      "Mark a goal as completed or dropped. Use when the user achieves or abandons a goal.",
    inputSchema: zodSchema(coachToolInputSchemas.close_goal),
    execute: async (input) => {
      const existing = getGoal(input.id);
      if (!existing) {
        return `Goal ${input.id} not found.`;
      }
      const closed = updateGoalStatus(input.id, input.status);
      if (!closed) {
        return `Failed to close goal ${input.id}.`;
      }
      return `Closed goal: ${closed.title} (status: ${closed.status})`;
    },
  }),

  search_memory: tool({
    description:
      "Search past coaching conversations for relevant context. Always call early in a session and when the user references something from before.",
    inputSchema: zodSchema(coachToolInputSchemas.search_memory),
    execute: async (input) => {
      let vector: number[];
      try {
        vector = await embed(input.query, "query");
      } catch (error) {
        return `Memory search failed: ${error instanceof Error ? error.message : "unknown error"}`;
      }

      const k = input.k ?? 4;
      const hits = searchEmbeddings(vector, { k });
      if (hits.length === 0) {
        return "No relevant past conversations found.";
      }
      return hits.map((hit) => `- ${clip(hit.text)}`).join("\n");
    },
  }),

  get_session_summary: tool({
    description:
      "Get a summary of the current or a recent session for context. Use during check-ins to understand prior progress.",
    inputSchema: zodSchema(coachToolInputSchemas.get_session_summary),
    execute: async (input, { context }) => {
      const currentSessionId = (context as { sessionId?: string } | undefined)
        ?.sessionId;

      let targetId = input.sessionId;
      if (!targetId && currentSessionId) {
        const prior = getMostRecentSession(currentSessionId);
        targetId = prior?.id;
      }
      if (!targetId) {
        return "No session found.";
      }

      const session = getSession(targetId);
      if (!session) {
        return `Session ${targetId} not found.`;
      }

      const summary = getSummary(targetId);
      if (summary) {
        return summary.content;
      }

      const messages = getMessages(targetId);
      if (messages.length === 0) {
        return "Session has no messages.";
      }

      const recent = messages.slice(-6);
      return formatTranscript(recent);
    },
  }),

  list_todos: tool({
    description:
      "Fetch the user's todos. Returns all open todos unless a goal id or status filter is specified. Todos are the concrete next actions tied to a goal.",
    inputSchema: zodSchema(coachToolInputSchemas.list_todos),
    execute: async (input) => {
      const todos = listTodos({
        goalId: input.goalId ?? undefined,
        status: input.status ?? undefined,
      });
      if (todos.length === 0) {
        return "No todos found.";
      }
      return todos
        .map(
          (t) =>
            `- [${t.status}] ${t.id}: ${t.title} (goal: ${t.goalId})${t.description ? ` — ${t.description}` : ""}`,
        )
        .join("\n");
    },
  }),

  create_todo: tool({
    description:
      "Create a new todo for an existing goal. Use when the user commits to a concrete next action under a goal. Call create_goal first if the goal does not exist yet.",
    inputSchema: zodSchema(coachToolInputSchemas.create_todo),
    execute: async (input) => {
      const goal = getGoal(input.goalId);
      if (!goal) {
        return `Goal ${input.goalId} not found. Create the goal first with create_goal.`;
      }
      const todo = createTodo({
        goalId: input.goalId,
        title: input.title,
        description: input.description ?? undefined,
      });
      if (!todo) {
        return `Failed to create todo under goal ${input.goalId}.`;
      }
      return `Created todo: ${todo.title} (id: ${todo.id})`;
    },
  }),

  update_todo: tool({
    description:
      "Update an existing todo's title, description, or status. Use when the user revises a step, starts it (in_progress), or finishes it (completed).",
    inputSchema: zodSchema(coachToolInputSchemas.update_todo),
    execute: async (input) => {
      const existing = getTodo(input.id);
      if (!existing) {
        return `Todo ${input.id} not found.`;
      }
      const updated = updateTodo(input.id, {
        title: input.title ?? undefined,
        description: input.description,
        status: input.status ?? undefined,
      });
      if (!updated) {
        return `Failed to update todo ${input.id}.`;
      }
      return `Updated todo: ${updated.title} (status: ${updated.status})`;
    },
  }),

  remove_todo: tool({
    description:
      "Permanently remove a todo. Use when the user decides a step is no longer relevant. For finishing a step, use update_todo with status completed instead.",
    inputSchema: zodSchema(coachToolInputSchemas.remove_todo),
    execute: async (input) => {
      if (!getTodo(input.id)) {
        return `Todo ${input.id} not found.`;
      }
      if (!deleteTodo(input.id)) {
        return `Failed to remove todo ${input.id}.`;
      }
      return `Removed todo ${input.id}.`;
    },
  }),
};