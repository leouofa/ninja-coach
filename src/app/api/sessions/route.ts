import { listSessions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listSessions());
}