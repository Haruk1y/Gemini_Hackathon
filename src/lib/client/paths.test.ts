import { describe, expect, it } from "vitest";

import { buildApiPath, buildAppPath, getAppBasePath } from "@/lib/client/paths";

describe("client path helpers", () => {
  it("uses the root app path for non-prefixed routes", () => {
    expect(getAppBasePath("/")).toBe("");
    expect(getAppBasePath("/lobby/ROOM1")).toBe("");
    expect(getAppBasePath("/round/ROOM1")).toBe("");
  });

  it("preserves the public mount prefix for the prefixed home route", () => {
    expect(getAppBasePath("/games/prompdojo/play")).toBe(
      "/games/prompdojo/play",
    );
    expect(buildAppPath("/games/prompdojo/play", "/")).toBe(
      "/games/prompdojo/play",
    );
    expect(buildAppPath("/games/prompdojo/play", "/lobby/ROOM1")).toBe(
      "/games/prompdojo/play/lobby/ROOM1",
    );
  });

  it("derives the public mount prefix from nested game routes", () => {
    expect(getAppBasePath("/games/prompdojo/play/lobby/ROOM1")).toBe(
      "/games/prompdojo/play",
    );
    expect(getAppBasePath("/games/prompdojo/play/results/ROOM1")).toBe(
      "/games/prompdojo/play",
    );
  });

  it("builds API paths for root and prefixed deployments", () => {
    expect(buildApiPath("/round/ROOM1", "/api/auth/anonymous")).toBe(
      "/api/auth/anonymous",
    );
    expect(
      buildApiPath(
        "/games/prompdojo/play/results/ROOM1",
        "/api/auth/anonymous",
      ),
    ).toBe("/games/prompdojo/play/api/auth/anonymous");
  });

  it("preserves query strings when building prefixed navigation targets", () => {
    expect(
      buildAppPath(
        "/games/prompdojo/play/results/ROOM1",
        "/transition/ROOM1?start=1",
      ),
    ).toBe("/games/prompdojo/play/transition/ROOM1?start=1");
  });
});
