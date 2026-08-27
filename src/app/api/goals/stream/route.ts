import { listOpenGoals } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 10000;

const encoder = new TextEncoder();

export function GET(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let previous = "";
      let closed = false;
      const timers: {
        poll?: ReturnType<typeof setInterval>;
        heartbeat?: ReturnType<typeof setInterval>;
      } = {};

      function cleanup() {
        if (closed) return;
        closed = true;
        if (timers.poll) clearInterval(timers.poll);
        if (timers.heartbeat) clearInterval(timers.heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      function sendSnapshot() {
        if (closed) return;
        try {
          const snapshot = JSON.stringify(listOpenGoals());
          if (snapshot === previous) return;
          previous = snapshot;
          controller.enqueue(
            encoder.encode(`event: goals\ndata: ${snapshot}\n\n`),
          );
        } catch (error) {
          console.error("[goals:stream] polling failed:", error);
          cleanup();
        }
      }

      function sendHeartbeat() {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }

      timers.poll = setInterval(sendSnapshot, POLL_INTERVAL_MS);
      timers.heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      request.signal.addEventListener("abort", cleanup, { once: true });

      sendSnapshot();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}