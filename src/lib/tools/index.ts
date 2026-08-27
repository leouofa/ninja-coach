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

export const coachTools = {
  list_goals: tool({
    description:
      "Fetch the user's current goals. Returns all goals unless a status filter is specified.",
    inputSchema: zodSchema(
      z.object({
        status: z
          .enum(["active", "paused", "completed", "dropped"])
          .optional()
          .describe("Filter by goal status. Omit for all goals."),
      }),
    ),
    execute: async (input) => {
      const goals = listGoals(input.status);
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
    inputSchema: zodSchema(
      z.object({
        title: z.string().describe("Goal title"),
        description: z
          .string()
          .optional()
          .describe("Optional goal description or details"),
      }),
    ),
    execute: async (input) => {
      const goal = createGoal({
        title: input.title,
        description: input.description,
      });
      return `Created goal: ${goal.title} (id: ${goal.id})`;
    },
  }),

  update_goal: tool({
    description:
      "Update an existing goal's title, description, or status. Use when the user revises a goal.",
    inputSchema: zodSchema(
      z.object({
        id: z.string().describe("Goal id"),
        title: z.string().optional().describe("New title"),
        description: z
          .string()
          .nullable()
          .optional()
          .describe("New description (null to clear)"),
        status: z
          .enum(["active", "paused", "completed", "dropped"])
          .optional()
          .describe("New status"),
      }),
    ),
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
    inputSchema: zodSchema(
      z.object({
        id: z.string().describe("Goal id"),
        status: z
          .enum(["completed", "dropped"])
          .describe("Final status: completed or dropped"),
      }),
    ),
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
    inputSchema: zodSchema(
      z.object({
        query: z
          .string()
          .describe("Search query — typically the user's message or topic"),
        k: z
          .number()
          .optional()
          .describe("Number of results to return (default 4)"),
      }),
    ),
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
    inputSchema: zodSchema(
      z.object({
        sessionId: z
          .string()
          .optional()
          .describe(
            "Session id to summarize. Omit for the most recent prior session.",
          ),
      }),
    ),
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
};
