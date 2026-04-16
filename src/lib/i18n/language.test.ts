import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_NAME,
  normalizeLanguage,
  parseLanguageCookie,
  serializeLanguageCookie,
} from "@/lib/i18n/language";

describe("language cookie helpers", () => {
  it("parses a supported language cookie", () => {
    expect(parseLanguageCookie(`${LANGUAGE_COOKIE_NAME}=en; theme=neo`)).toBe("en");
  });

  it("returns null when the language cookie is missing or invalid", () => {
    expect(parseLanguageCookie("theme=neo")).toBeNull();
    expect(parseLanguageCookie(`${LANGUAGE_COOKIE_NAME}=fr`)).toBeNull();
  });

  it("defaults to English but preserves explicit supported languages", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("ja")).toBe("ja");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("serializes the cookie with the expected attributes", () => {
    expect(serializeLanguageCookie("ja")).toContain(`${LANGUAGE_COOKIE_NAME}=ja`);
    expect(serializeLanguageCookie("ja")).toContain("Path=/");
    expect(serializeLanguageCookie("ja")).toContain("SameSite=Lax");
  });
});
