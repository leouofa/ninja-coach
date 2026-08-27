import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { getModel } from "@/lib/ai";
import { toUIMessages, uiMessageText } from "@/lib/chat/messages";
import { addMessage, getSession } from "@/lib/db/queries";
import {
  buildContext,
  maybeSummarizeSession,
  rememberExchange,
} from "@/lib/memory";
import { coachTools } from "@/lib/tools";

interface ChatRequestBody {
  sessionId?: unknown;
  message?: unknown;
}

function parseIncomingMessage(value: unknown): UIMessage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, role, parts } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (role !== "user" || !Array.isArray(parts)) return undefined;
  const message: UIMessage = {
    id,
    role: "user",
    parts: parts as UIMessage["parts"],
  };
  if (!uiMessageText(message).trim()) return undefined;
  return message;
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const incoming = parseIncomingMessage(body.message);
  if (!sessionId || !incoming) {
    return Response.json(
      { error: "sessionId and a non-empty user text message are required." },
      { status: 400 },
    );
  }

  if (!getSession(sessionId)) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  let model;
  try {
    model = getModel();
  } catch (error) {
    console.error("[chat] model configuration error:", error);
    return Response.json(
      { error: "Chat is not configured. Check the server logs." },
      { status: 500 },
    );
  }

  addMessage({
    id: incoming.id,
    sessionId,
    role: "user",
    content: uiMessageText(incoming),
  });

  try {
    await maybeSummarizeSession(sessionId);
  } catch (error) {
    console.error("[chat] summarization failed:", error);
  }

  const { system, window } = await buildContext(sessionId);
  const history = toUIMessages(window);

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(history),
    tools: coachTools,
    stopWhen: isStepCount(8),
    onError({ error }) {
      console.error("[chat] streaming error:", error);
    },
  });

  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: coachTools,
      originalMessages: history,
      onError: () => "Something went wrong while coaching. Please try again.",
      onEnd: ({ messages }) => {
        const replies: string[] = [];
        for (const message of messages.slice(history.length)) {
          if (message.role !== "assistant") continue;
          const text = uiMessageText(message);
          if (!text.trim()) continue;
          addMessage({ sessionId, role: "assistant", content: text });
          replies.push(text.trim());
        }

        const coachReply = replies.join("\n").trim();
        if (coachReply) {
          void rememberExchange({
            userMessageId: incoming.id,
            userText: uiMessageText(incoming),
            assistantText: coachReply,
          }).catch((error) => {
            console.error("[chat] failed to remember exchange:", error);
          });
        }
      },
    }),
  });
}
