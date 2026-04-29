import {
  neon,
  type NeonQueryFunction,
} from "@neondatabase/serverless";

import { AppError } from "@/lib/utils/errors";

export type ThemeCatalogSql = NeonQueryFunction<false, false>;

let themeCatalogSql: ThemeCatalogSql | null | undefined;

export function resolveThemeCatalogDatabaseUrl(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | null {
  const databaseUrl = env.DATABASE_URL?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function getOptionalThemeCatalogSql(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ThemeCatalogSql | null {
  if (themeCatalogSql !== undefined) {
    return themeCatalogSql;
  }

  const databaseUrl = resolveThemeCatalogDatabaseUrl(env);
  if (!databaseUrl) {
    themeCatalogSql = null;
    return themeCatalogSql;
  }

  themeCatalogSql = neon(databaseUrl);
  return themeCatalogSql;
}

export function requireThemeCatalogSql(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ThemeCatalogSql {
  const sql = getOptionalThemeCatalogSql(env);
  if (!sql) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Neon DATABASE_URL is not configured for the theme catalog.",
      false,
      500,
    );
  }

  return sql;
}

export const __test__ = {
  resetThemeCatalogSql() {
    themeCatalogSql = undefined;
  },
};
