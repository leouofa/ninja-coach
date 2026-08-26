import { notFound } from "next/navigation";

import { Chat } from "@/components/chat";
import { SessionBadge } from "@/components/session-badge";
import { toUIMessages } from "@/lib/chat/messages";
import { formatDate, isSameDay } from "@/lib/format";
import { getMessages, getSession } from "@/lib/db/queries";

export default async function ChatPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  const session = getSession(id);
  if (!session) {
    notFound();
  }
  const initialMessages = toUIMessages(getMessages(id));

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[30rem] flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {session.title}
            </h1>
            <SessionBadge kind={session.kind} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {isSameDay(session.createdAt, session.updatedAt)
              ? formatDate(session.createdAt)
              : `Created ${formatDate(session.createdAt)} · Last active ${formatDate(session.updatedAt)}`}
          </p>
        </div>
      </div>
      <Chat sessionId={id} initialMessages={initialMessages} />
    </div>
  );
}
