import { redirect } from "next/navigation";

import { createSession } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function CheckInPage() {
  const session = createSession({ kind: "checkin", title: "Weekly check-in" });
  redirect(`/chat/${session.id}`);
}
