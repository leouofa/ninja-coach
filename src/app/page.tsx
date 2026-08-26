import Link from "next/link";

import { SessionBadge } from "@/components/session-badge";
import { formatDate, isSameDay } from "@/lib/format";
import { listSessions } from "@/lib/db/queries";
import type { Session } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function SessionDates({ session }: { session: Session }) {
  const created = formatDate(session.createdAt);
  const active = formatDate(session.updatedAt);
  return (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">
      {isSameDay(session.createdAt, session.updatedAt)
        ? created
        : `Created ${created} · Last active ${active}`}
    </p>
  );
}

function EmptyHistory() {
  return (
    <div className="m-auto max-w-md rounded-2xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
      <h1 className="text-lg font-semibold tracking-tight">Welcome</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        Your coaching sessions will appear here. Start a conversation or run
        your first weekly check-in.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/new"
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Start chatting
        </Link>
        <Link
          href="/checkin"
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Weekly check-in
        </Link>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const sessions = listSessions();

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      {sessions.length === 0 ? (
        <EmptyHistory />
      ) : (
        <>
          <h1 className="text-lg font-semibold tracking-tight">Sessions</h1>
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/chat/${session.id}`}
                  className="flex items-center justify-between gap-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {session.title}
                      </span>
                      <SessionBadge kind={session.kind} />
                    </div>
                    <SessionDates session={session} />
                  </div>
                  <span
                    aria-hidden
                    className="shrink-0 text-sm text-zinc-400 dark:text-zinc-600"
                  >
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
