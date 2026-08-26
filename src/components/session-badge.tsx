export function SessionBadge({ kind }: { kind: "open" | "checkin" }) {
  if (kind !== "checkin") return null;
  return (
    <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      Weekly check-in
    </span>
  );
}
