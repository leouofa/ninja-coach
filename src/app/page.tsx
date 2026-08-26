import { redirect } from "next/navigation";

import { createSession, listSessions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  const session = listSessions()[0] ?? createSession();
  redirect(`/chat/${session.id}`);
}
