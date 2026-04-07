import { beforeEach, describe, expect, it, vi } from "vitest";

const runTransaction = vi.fn();
const getAdminDb = vi.fn(() => ({
  runTransaction,
}));
const attemptPrivateRef = vi.fn();

vi.mock("@/lib/google-cloud/admin", () => ({
  getAdminDb,
}));

vi.mock("@/lib/api/paths", () => ({
  attemptPrivateRef,
}));

describe("rollbackReservedAttempt", () => {
  beforeEach(() => {
    vi.resetModules();
    runTransaction.mockReset();
    attemptPrivateRef.mockReset();
  });

  it("deletes a newly created attempts document", async () => {
    const ref = { id: "attempt-ref" };
    attemptPrivateRef.mockReturnValue(ref);

    runTransaction.mockImplementation(async (handler: (tx: {
      get: (target: unknown) => Promise<{ exists: boolean }>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: true }),
        delete: vi.fn(),
        update: vi.fn(),
      };
      await handler(tx);
      expect(tx.delete).toHaveBeenCalledWith(ref);
      expect(tx.update).not.toHaveBeenCalled();
    });

    const { rollbackReservedAttempt } = await import("@/app/api/rounds/submit/route");
    await rollbackReservedAttempt({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "anon_1",
      attemptNo: 1,
      createdDoc: true,
    });
  });

  it("removes the pending attempt and decrements attemptsUsed for existing docs", async () => {
    const ref = { id: "attempt-ref" };
    attemptPrivateRef.mockReturnValue(ref);

    runTransaction.mockImplementation(async (handler: (tx: {
      get: (target: unknown) => Promise<{
        exists: boolean;
        data: () => {
          attemptsUsed: number;
          attempts: Array<{ attemptNo: number }>;
        };
      }>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<void>) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            attemptsUsed: 2,
            attempts: [{ attemptNo: 1 }, { attemptNo: 2 }],
          }),
        }),
        delete: vi.fn(),
        update: vi.fn(),
      };
      await handler(tx);
      expect(tx.delete).not.toHaveBeenCalled();
      expect(tx.update).toHaveBeenCalledWith(
        ref,
        expect.objectContaining({
          attemptsUsed: 1,
          attempts: [{ attemptNo: 1 }],
        }),
      );
    });

    const { rollbackReservedAttempt } = await import("@/app/api/rounds/submit/route");
    await rollbackReservedAttempt({
      roomId: "ROOM1",
      roundId: "round-1",
      uid: "anon_1",
      attemptNo: 2,
      createdDoc: false,
    });
  });
});
