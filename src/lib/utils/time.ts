const HOUR_MS = 60 * 60 * 1000;

export function dateAfterHours(hours: number): Date {
  return new Date(Date.now() + hours * HOUR_MS);
}

export function parseDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function millisecondsLeft(endsAt: unknown): number {
  const parsed = parseDate(endsAt);
  if (!parsed) return 0;
  return Math.max(0, parsed.getTime() - Date.now());
}

export function formatSeconds(value: number): string {
  const clamped = Math.max(0, Math.floor(value));
  const m = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const s = (clamped % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
