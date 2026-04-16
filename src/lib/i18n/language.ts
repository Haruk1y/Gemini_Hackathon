export type Language = "ja" | "en";

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_COOKIE_NAME = "pmb_lang";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLanguage(value: unknown): value is Language {
  return value === "ja" || value === "en";
}

export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function parseLanguageCookie(cookieHeader: string | null | undefined): Language | null {
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_COOKIE_NAME}=`));

  if (!cookie) {
    return null;
  }

  const value = cookie.slice(LANGUAGE_COOKIE_NAME.length + 1);
  return isLanguage(value) ? value : null;
}

export function serializeLanguageCookie(language: Language): string {
  return [
    `${LANGUAGE_COOKIE_NAME}=${language}`,
    "Path=/",
    `Max-Age=${LANGUAGE_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ].join("; ");
}

export function writeLanguageCookie(language: Language) {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = serializeLanguageCookie(language);
}
