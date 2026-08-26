import { redirect } from "next/navigation";

import { createSession } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function NewChatPage() {
  const session = createSession();
  redirect(`/chat/${session.id}`);
}
