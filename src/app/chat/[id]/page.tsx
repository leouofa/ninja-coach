import { notFound } from "next/navigation";

import { Chat } from "@/components/chat";
import { toUIMessages } from "@/lib/chat/messages";
import { getMessages, getSession } from "@/lib/db/queries";

export default async function ChatPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;
  if (!getSession(id)) {
    notFound();
  }
  const initialMessages = toUIMessages(getMessages(id));
  return <Chat sessionId={id} initialMessages={initialMessages} />;
}
