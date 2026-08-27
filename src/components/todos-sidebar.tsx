"use client";

import type { TodoWithGoal } from "@/lib/db/queries";
import { useEffect, useState } from "react";

const STATUS_COLOR: Record<TodoWithGoal["status"], string> = {
  pending: "bg-zinc-400 dark:bg-zinc-600",
  in_progress: "bg-amber-400 dark:bg-amber-500",
  completed: "bg-emerald-500",
};

export function TodosSidebar() {
  const [todos, setTodos] = useState<TodoWithGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function apply(data: TodoWithGoal[]) {
      if (!active) return;
      setTodos(data);
      setLoading(false);
    }

    function load() {
      fetch("/api/todos")
        .then((res) => (res.ok ? res.json() : []))
        .then(apply)
        .catch(() => {
          if (active) setLoading(false);
        });
    }

    load();

    function connect() {
      source?.close();
      source = new EventSource("/api/todos/stream");
      source.addEventListener("todos", (event) => {
        try {
          apply(JSON.parse(event.data));
        } catch {
          // ignore malformed payloads
        }
      });
      source.addEventListener("error", () => {
        source?.close();
        if (active) {
          retry = setTimeout(connect, 3000);
        }
      });
    }

    connect();

    return () => {
      active = false;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold tracking-tight">Todos</h2>
      {loading ? (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Loading…
        </p>
      ) : todos.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          No todos yet — ask your coach to break a goal into steps.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2">
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${STATUS_COLOR[todo.status]}`}
              />
              <span className="min-w-0 text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                <span className="block">{todo.title}</span>
                <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                  {todo.status === "in_progress" ? "In progress · " : ""}
                  {todo.goalTitle}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}