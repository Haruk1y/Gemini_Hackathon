import { describe, expect, it } from "vitest";

import {
  __test__,
  getOptionalThemeCatalogSql,
  requireThemeCatalogSql,
  resolveThemeCatalogDatabaseUrl,
} from "@/lib/theme-catalog/db";
import { AppError } from "@/lib/utils/errors";

describe("theme catalog database connection", () => {
  it("resolves DATABASE_URL when present", () => {
    expect(
      resolveThemeCatalogDatabaseUrl({
        DATABASE_URL: "  postgresql://user:pass@example.neon.tech/db  ",
      }),
    ).toBe("postgresql://user:pass@example.neon.tech/db");
  });

  it("returns null for optional access when DATABASE_URL is absent", () => {
    __test__.resetThemeCatalogSql();

    expect(getOptionalThemeCatalogSql({})).toBeNull();
  });

  it("throws a clear error for required access when DATABASE_URL is absent", () => {
    __test__.resetThemeCatalogSql();

    expect(() => requireThemeCatalogSql({})).toThrow(AppError);
    expect(() => requireThemeCatalogSql({})).toThrow(
      "Neon DATABASE_URL is not configured for the theme catalog.",
    );
  });

  it("creates a lazy Neon query function without opening a connection", () => {
    __test__.resetThemeCatalogSql();

    const sql = requireThemeCatalogSql({
      DATABASE_URL: "postgresql://user:pass@example.neon.tech/db?sslmode=require",
    });

    expect(typeof sql).toBe("function");
    expect(typeof sql.query).toBe("function");
  });
});
