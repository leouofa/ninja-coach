import { createTextStreamResponse, streamText, toTextStream } from "ai";

import { getModel } from "@/lib/ai";

export async function GET(request: Request) {
  const prompt =
    new URL(request.url).searchParams.get("prompt") ??
    "Say hello and introduce yourself in one short sentence.";

  let result;
  try {
    result = streamText({
      model: getModel(),
      prompt,
      onError({ error }) {
        console.error("[ai-test] streaming error:", error);
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to start completion." },
      { status: 500 },
    );
  }

  return createTextStreamResponse({
    stream: toTextStream({ stream: result.stream }),
  });
}
