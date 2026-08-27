"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { SessionBadge } from "@/components/session-badge";
import { formatDate, isSameDay } from "@/lib/format";
import type { Session } from "@/lib/db/schema";

function SessionDates({ session }: { session: Session }) {
  const created = new Date(session.createdAt);
  const active = new Date(session.updatedAt);
  return (
    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
      {isSameDay(created, active)
        ? formatDate(created)
        : `Created ${formatDate(created)}`}
    </p>
  );
}

export function SessionsSidebar() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function apply(data: Session[]) {
      if (!active) return;
      setSessions(data);
      setLoading(false);
    }

    function load() {
      fetch("/api/sessions")
        .then((res) => (res.ok ? res.json() : []))
        .then(apply)
        .catch(() => {
          if (active) setLoading(false);
        });
    }

    load();

    function connect() {
      source?.close();
      source = new EventSource("/api/sessions/stream");
      source.addEventListener("sessions", (event) => {
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 lg:flex">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Ninja Coach
        </Link>
      </div>
      <div className="px-3">
        <Link
          href="/new"
          className="flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <span aria-hidden className="text-base leading-none">
            +
          </span>
          New chat
        </Link>
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <p className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500">
            Loading…
          </p>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            No sessions yet — start a chat to begin coaching.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const href = `/chat/${session.id}`;
              const active = pathname === href;
              return (
                <li key={session.id}>
                  <Link
                    href={href}
                    className={`block rounded-xl px-2 py-2 transition-colors ${
                      active
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {session.title}
                      </span>
                      <SessionBadge kind={session.kind} />
                    </div>
                    <SessionDates session={session} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Link
          href="/checkin"
          className="block rounded-xl px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Weekly check-in
        </Link>
      </div>
    </aside>
  );
}