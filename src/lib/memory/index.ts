import "server-only";

import { randomUUID } from "node:crypto";

import { generateText } from "ai";
import { eq } from "drizzle-orm";

import { getModel } from "../ai";
import { COACH_PERSONA, CHECKIN_STRUCTURE } from "../coach/persona";
import { db } from "../db";
import {
  getMessages,
  getMostRecentSession,
  getSession,
} from "../db/queries";
import {
  summaries,
  type Message,
  type Summary,
} from "../db/schema";
import { insertEmbedding } from "../db/vector-search";
import { embed } from "../embeddings";

export const VERBATIM_WINDOW = 16;
export const SUMMARIZE_CHUNK = 8;

const SUMMARIZER_PROMPT =
  "Summarize the following coaching conversation as a compact third-person " +
  "recap. Preserve goals, commitments, progress numbers, and personal facts " +
  "the coach would need later. Reply with the summary only, no preamble.";

export type SummarizeFn = (transcript: string) => Promise<string>;

function formatTranscript(messages: Message[]): string {
  return messages
    .map((m) => `${m.role === "assistant" ? "Coach" : "User"}: ${m.content}`)
    .join("\n");
}

export interface RememberExchangeInput {
  userMessageId: string;
  userText: string;
  assistantText: string;
}

/**
 * Stores one user/coach exchange as a single retrievable document.
 * Keyed by the user message id so it can be excluded from retrieval
 * while still present verbatim in the context window.
 */
export async function rememberExchange(
  input: RememberExchangeInput,
): Promise<void> {
  const userText = input.userText.trim();
  const assistantText = input.assistantText.trim();
  if (!userText || !assistantText) {
    return;
  }

  const text = `User: ${userText}\nCoach: ${assistantText}`;
  await insertEmbedding({
    sourceType: "exchange",
    sourceId: input.userMessageId,
    text,
    vector: await embed(text),
  });
}

export function getSummary(sessionId: string): Summary | undefined {
  return db
    .select()
    .from(summaries)
    .where(eq(summaries.sessionId, sessionId))
    .get();
}

async function defaultSummarize(transcript: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system: SUMMARIZER_PROMPT,
    prompt: transcript,
  });
  return text.trim();
}

/**
 * Compacts history older than the verbatim window into a per-session
 * summary. Runs lazily: only when at least SUMMARIZE_CHUNK uncovered
 * messages have piled up past the window.
 */
export async function maybeSummarizeSession(
  sessionId: string,
  options: { summarize?: SummarizeFn } = {},
): Promise<Summary | undefined> {
  const history = getMessages(sessionId);
  const targetCoverage = history.length - VERBATIM_WINDOW;
  if (targetCoverage <= 0) {
    return getSummary(sessionId);
  }

  const existing = getSummary(sessionId);
  const covered = existing?.coveredMessages ?? 0;
  if (targetCoverage - covered < SUMMARIZE_CHUNK) {
    return existing;
  }

  const summarize = options.summarize ?? defaultSummarize;
  const content = await summarize(
    formatTranscript(history.slice(0, targetCoverage)),
  );
  if (!content) {
    throw new Error("Session summarizer returned empty output.");
  }

  if (existing) {
    return db
      .update(summaries)
      .set({ content, coveredMessages: targetCoverage, updatedAt: new Date() })
      .where(eq(summaries.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(summaries)
    .values({
      id: randomUUID(),
      sessionId,
      content,
      coveredMessages: targetCoverage,
    })
    .returning()
    .get();
}

const RECAP_MESSAGE_COUNT = 6;

function lastSessionRecap(currentSessionId: string): string | undefined {
  const prior = getMostRecentSession(currentSessionId);
  if (!prior) {
    return undefined;
  }

  const summary = getSummary(prior.id);
  if (summary) {
    return summary.content;
  }

  const recent = getMessages(prior.id).slice(-RECAP_MESSAGE_COUNT);
  if (recent.length === 0) {
    return undefined;
  }
  return formatTranscript(recent);
}

export interface BuiltContext {
  system: string;
  /** Messages sent verbatim; always bounded by VERBATIM_WINDOW. */
  window: Message[];
}

/**
 * Builds the context for the next turn: persona + (for check-in sessions)
 * structure and a recap of the most recent prior session + summary of
 * compacted history + the verbatim window.
 */
export async function buildContext(sessionId: string): Promise<BuiltContext> {
  const session = getSession(sessionId);
  const history = getMessages(sessionId);
  const window = history.slice(-VERBATIM_WINDOW);

  const sections = [COACH_PERSONA];

  if (session?.kind === "checkin") {
    sections.push(CHECKIN_STRUCTURE);
    const recap = lastSessionRecap(sessionId);
    if (recap) {
      sections.push(`Since last session:\n${recap}`);
    }
  }

  const summary = getSummary(sessionId);
  if (summary) {
    sections.push(`Earlier in this conversation:\n${summary.content}`);
  }

  return { system: sections.join("\n\n"), window };
}
