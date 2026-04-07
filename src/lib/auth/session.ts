import { createHmac, timingSafeEqual } from "node:crypto";

import { nanoid } from "nanoid";

export interface SessionPayload {
  uid: string;
  issuedAt: number;
}

export const SESSION_COOKIE_NAME = "prompdojo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSessionSecret(): string {
  return requiredEnv("SESSION_SECRET");
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function createAnonymousSession(uid = `anon_${nanoid(16)}`): SessionPayload {
  return {
    uid,
    issuedAt: Date.now(),
  };
}

export function encodeSessionCookie(payload: SessionPayload): string {
  const body = toBase64Url(JSON.stringify(payload));
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function decodeSessionCookie(rawValue: string | undefined): SessionPayload | null {
  if (!rawValue) return null;

  const [body, signature] = rawValue.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(body)) as SessionPayload;
    if (typeof parsed.uid !== "string" || typeof parsed.issuedAt !== "number") {
      return null;
    }

    if (parsed.issuedAt + SESSION_TTL_SECONDS * 1000 < Date.now()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
