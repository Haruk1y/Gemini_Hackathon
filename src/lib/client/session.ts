import { buildCurrentApiPath } from "@/lib/client/paths";

export interface AnonymousSession {
  uid: string;
  issuedAt?: string | number;
}

function parseSession(payload: unknown): AnonymousSession | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record,
    record.session,
    record.user,
    record.data,
    record.result,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const session = candidate as Record<string, unknown>;
    const uid = session.uid;
    if (typeof uid === "string" && uid.trim().length > 0) {
      const issuedAt = session.issuedAt;
      return {
        uid,
        issuedAt:
          typeof issuedAt === "string" || typeof issuedAt === "number"
            ? issuedAt
            : undefined,
      };
    }
  }

  return null;
}

export async function bootstrapAnonymousSession(): Promise<AnonymousSession> {
  const response = await fetch(buildCurrentApiPath("/api/auth/anonymous"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String(
            (json as Record<string, unknown>).error ??
              "Session bootstrap failed",
          )
        : "Session bootstrap failed";
    throw new Error(message);
  }

  const session = parseSession(json);
  if (!session) {
    throw new Error("Anonymous session response was invalid");
  }

  return session;
}
