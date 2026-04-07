import { decodeSessionCookie, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth/session";
import { AppError } from "@/lib/utils/errors";

interface CookieStore {
  get(name: string): { value: string } | undefined;
}

export interface AuthContext {
  uid: string;
  session: SessionPayload;
}

export function verifySessionCookie(cookies: CookieStore): AuthContext {
  const raw = cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = decodeSessionCookie(raw);

  if (!session) {
    throw new AppError("UNAUTHORIZED", "Missing or invalid session", false, 401);
  }

  return {
    uid: session.uid,
    session,
  };
}
