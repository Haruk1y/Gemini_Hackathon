import { describe, expect, it } from "vitest";

import {
  PUBLIC_MOUNT_PREFIX,
  normalizePrefix,
  resolveAssetPrefix,
  resolvePublicAppOrigin,
} from "@/lib/config/public-origin";

describe("public origin config", () => {
  it("normalizes configured prefixes by removing a trailing slash", () => {
    expect(normalizePrefix("https://prompdojo.vercel.app/")).toBe(
      "https://prompdojo.vercel.app",
    );
    expect(normalizePrefix("/games/prompdojo/play/")).toBe(
      "/games/prompdojo/play",
    );
  });

  it("prefers NEXT_PUBLIC_APP_ORIGIN over APP_BASE_URL", () => {
    expect(
      resolvePublicAppOrigin({
        NEXT_PUBLIC_APP_ORIGIN: "https://public.example.com/",
        APP_BASE_URL: "https://app.example.com/",
      }),
    ).toBe("https://public.example.com");
  });

  it("falls back to APP_BASE_URL when NEXT_PUBLIC_APP_ORIGIN is unset", () => {
    expect(
      resolvePublicAppOrigin({
        APP_BASE_URL: "https://prompdojo.vercel.app/",
      }),
    ).toBe("https://prompdojo.vercel.app");
  });

  it("uses ASSET_PREFIX when it is explicitly configured", () => {
    expect(
      resolveAssetPrefix({
        ASSET_PREFIX: "https://cdn.example.com/prompdojo/",
        APP_BASE_URL: "https://prompdojo.vercel.app/",
      }),
    ).toBe("https://cdn.example.com/prompdojo");
  });

  it("builds an absolute mount-path asset prefix from APP_BASE_URL by default", () => {
    expect(
      resolveAssetPrefix({
        APP_BASE_URL: "https://prompdojo.vercel.app/",
      }),
    ).toBe(`https://prompdojo.vercel.app${PUBLIC_MOUNT_PREFIX}`);
  });

  it("falls back to the public mount path when no origin is configured", () => {
    expect(resolveAssetPrefix({})).toBe(PUBLIC_MOUNT_PREFIX);
  });
});
