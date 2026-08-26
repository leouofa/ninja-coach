import type { UIMessage } from "ai";

import type { Message } from "@/lib/db/schema";

export function toUIMessage(row: Message): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
  };
}

export function toUIMessages(rows: Message[]): UIMessage[] {
  return rows.map(toUIMessage);
}

export function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
