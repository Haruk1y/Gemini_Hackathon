export const PUBLIC_MOUNT_PREFIX = "/games/prompdojo/play";

type PublicOriginEnv = Partial<
  Record<string, string | undefined>
>;

export function normalizePrefix(value: string): string {
  if (!value) {
    return "";
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolvePublicAppOrigin(env: PublicOriginEnv): string {
  const explicitOrigin = env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (explicitOrigin) {
    return normalizePrefix(explicitOrigin);
  }

  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (appBaseUrl) {
    return normalizePrefix(appBaseUrl);
  }

  return "";
}

export function resolveAssetPrefix(env: PublicOriginEnv): string {
  const configuredPrefix = env.ASSET_PREFIX?.trim();
  if (configuredPrefix) {
    return normalizePrefix(configuredPrefix);
  }

  const publicOrigin = resolvePublicAppOrigin(env);
  if (publicOrigin) {
    return `${publicOrigin}${PUBLIC_MOUNT_PREFIX}`;
  }

  return PUBLIC_MOUNT_PREFIX;
}
