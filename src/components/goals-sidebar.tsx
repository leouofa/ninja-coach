"use client";

import type { Goal } from "@/lib/db/schema";
import { useEffect, useState } from "react";

export function GoalsSidebar() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function apply(data: Goal[]) {
      if (!active) return;
      setGoals(data);
      setLoading(false);
    }

    function load() {
      fetch("/api/goals")
        .then((res) => (res.ok ? res.json() : []))
        .then(apply)
        .catch(() => {
          if (active) setLoading(false);
        });
    }

    load();

    function connect() {
      source?.close();
      source = new EventSource("/api/goals/stream");
      source.addEventListener("goals", (event) => {
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
      <h2 className="text-sm font-semibold tracking-tight">Goals</h2>
      {loading ? (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
          Loading…
        </p>
      ) : goals.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          No goals yet — ask your coach to set one up.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {goals.map((goal) => (
            <li key={goal.id} className="flex items-start gap-2">
              <span
                className={`mt-1 size-1.5 shrink-0 rounded-full ${
                  goal.status === "paused"
                    ? "bg-amber-400 dark:bg-amber-500"
                    : "bg-emerald-500"
                }`}
              />
              <span className="text-xs leading-5 text-zinc-700 dark:text-zinc-300">
                {goal.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}