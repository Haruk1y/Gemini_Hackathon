"use client";

const KNOWN_APP_ROUTE_SEGMENTS = new Set([
  "mockups",
  "lobby",
  "round",
  "results",
  "transition",
]);

function getApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function getCurrentOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const compact = normalized.replace(/\/{2,}/g, "/");
  if (compact.length > 1 && compact.endsWith("/")) {
    return compact.slice(0, -1);
  }

  return compact;
}

function splitTarget(target: string): {
  pathname: string;
  suffix: string;
} {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");

  let suffixIndex = -1;
  if (hashIndex >= 0 && queryIndex >= 0) {
    suffixIndex = Math.min(hashIndex, queryIndex);
  } else {
    suffixIndex = Math.max(hashIndex, queryIndex);
  }

  if (suffixIndex < 0) {
    return {
      pathname: target,
      suffix: "",
    };
  }

  return {
    pathname: target.slice(0, suffixIndex),
    suffix: target.slice(suffixIndex),
  };
}

function buildPath(basePath: string, target: string): string {
  const { pathname, suffix } = splitTarget(target);
  const normalizedTarget = normalizePathname(pathname || "/");

  if (!basePath) {
    return `${normalizedTarget}${suffix}`;
  }

  if (normalizedTarget === "/") {
    return `${basePath}${suffix}`;
  }

  return `${basePath}${normalizedTarget}${suffix}`;
}

export function getAppBasePath(pathname: string): string {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === "/") {
    return "";
  }

  const segments = normalizedPathname.split("/").filter(Boolean);
  const routeIndex = segments.findIndex((segment) =>
    KNOWN_APP_ROUTE_SEGMENTS.has(segment),
  );

  if (routeIndex <= 0) {
    return routeIndex === 0 ? "" : normalizedPathname;
  }

  return `/${segments.slice(0, routeIndex).join("/")}`;
}

export function buildAppPath(pathname: string, target: string): string {
  return buildPath(getAppBasePath(pathname), target);
}

export function buildApiPath(pathname: string, target: string): string {
  return buildPath(getAppBasePath(pathname), target);
}

function getCurrentPathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return window.location.pathname;
}

export function buildCurrentAppPath(target: string): string {
  return buildAppPath(getCurrentPathname(), target);
}

export function buildCurrentApiPath(target: string): string {
  const apiOrigin = getApiOrigin();
  const currentOrigin = getCurrentOrigin();

  if (apiOrigin && currentOrigin && currentOrigin !== apiOrigin) {
    const { pathname, suffix } = splitTarget(target);
    const normalizedPath = normalizePathname(pathname || "/");
    return `${apiOrigin}${normalizedPath}${suffix}`;
  }

  return buildApiPath(getCurrentPathname(), target);
}
