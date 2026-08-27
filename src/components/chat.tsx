"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface ChatProps {
  sessionId: string;
  initialMessages: UIMessage[];
}

function ToolIndicator({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);

  const labels: Record<string, string> = {
    search_memory: "Searching memory…",
    list_goals: "Loading goals…",
    create_goal: "Creating goal",
    update_goal: "Updating goal",
    close_goal: "Closing goal",
    get_session_summary: "Loading session summary…",
  };

  const label = labels[name] ?? name;

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        <span className="size-1.5 animate-pulse rounded-full bg-zinc-400 dark:bg-zinc-500" />
        {label}
      </div>
    );
  }

  if (part.state === "output-available") {
    const output =
      typeof part.output === "string" ? part.output : JSON.stringify(part.output);
    if (!output || output === '""') return null;
    return (
      <div className="rounded-lg bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
        <span className="font-medium">{label.replace("…", "")}:</span>{" "}
        {output.length > 120 ? output.slice(0, 119) + "…" : output}
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-500 dark:bg-red-950 dark:text-red-400">
        {label} failed
      </div>
    );
  }

  return null;
}

export function Chat({ sessionId, initialMessages }: ChatProps) {
  const { messages, sendMessage, status, stop, regenerate, error } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          sessionId,
          message: messages[messages.length - 1],
        },
      }),
    }),
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isWorking = status === "submitted" || status === "streaming";
  const canSend = status === "ready" && input.trim().length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages, status]);

  function send() {
    const text = input.trim();
    if (!text || status !== "ready") return;
    sendMessage({ text });
    setInput("");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex flex-1 flex-col justify-start gap-4 overflow-y-auto"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-md rounded-2xl border border-zinc-200 p-6 text-center text-sm leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <p>
              Your coach is ready. Share a goal, report on last week,
              or just say hi to get started.
            </p>
            <Link
              href="/checkin"
              className="mt-3 inline-block font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              Start weekly check-in
            </Link>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm leading-6 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm leading-6 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              }
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return <span key={index}>{part.text}</span>;
                }
                if (isToolUIPart(part)) {
                  return <ToolIndicator key={index} part={part} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {error && (
          <div className="flex items-center justify-between gap-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            <span>Something went wrong. Please try again.</span>
            <button
              type="button"
              onClick={() => regenerate()}
              className="shrink-0 font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message your coach..."
            rows={1}
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-zinc-300 bg-transparent px-4 py-3 text-sm leading-5 outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
          />
          {isWorking ? (
            <button
              type="button"
              onClick={() => stop()}
              className="h-11 shrink-0 rounded-2xl border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="h-11 shrink-0 rounded-2xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
