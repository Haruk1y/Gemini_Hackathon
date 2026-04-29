import { describe, expect, it, vi } from "vitest";

import {
  createAhaChange,
  createAhaTheme,
  listApprovedAhaChanges,
  normalizeAnswerBox,
  recordAhaChangeFeedback,
} from "@/lib/theme-catalog/aha";

const now = "2026-04-29T06:00:00.000Z";

function themeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "approved",
    game_mode: "change",
    image_model: "gemini",
    aspect_ratio: "1:1",
    prompt: "A clean kitchen counter with many props, no text",
    title: "Kitchen Counter",
    tags: ["change", "kitchen"],
    difficulty: 2,
    blob_url: "https://blob.example/base.png",
    blob_path: "themes/base.png",
    thumb_blob_url: null,
    thumb_blob_path: null,
    style_preset_id: "change-realistic",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function changeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    theme_id: "11111111-1111-1111-1111-111111111111",
    status: "approved",
    edit_prompt: "Turn the yellow mug into a blue bottle.",
    changed_blob_url: "https://blob.example/changed.png",
    changed_blob_path: "themes/changed.png",
    answer_box: {
      x: 0.2,
      y: 0.3,
      width: 0.18,
      height: 0.22,
    },
    change_summary: "yellow mug becomes blue bottle",
    weight: 1,
    usage_count: 0,
    last_used_at: null,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    disabled_reason: null,
    feedback_ok_count: 0,
    feedback_low_quality_count: 0,
    feedback_report_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Aha theme catalog helpers", () => {
  it("registers one base theme with multiple change patterns", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([themeRow()])
      .mockResolvedValueOnce([changeRow({ id: "change-a" })])
      .mockResolvedValueOnce([changeRow({
        id: "change-b",
        edit_prompt: "Move the red spoon to the left side.",
        changed_blob_path: "themes/changed-b.png",
      })]);
    const sql = { query };

    const theme = await createAhaTheme(
      {
        status: "approved",
        imageModel: "gemini",
        aspectRatio: "1:1",
        prompt: "A clean kitchen counter with many props, no text",
        title: "Kitchen Counter",
        tags: ["change", "kitchen"],
        difficulty: 2,
        blobUrl: "https://blob.example/base.png",
        blobPath: "themes/base.png",
        stylePresetId: "change-realistic",
      },
      sql,
    );
    const first = await createAhaChange(
      {
        themeId: theme.id,
        status: "approved",
        editPrompt: "Turn the yellow mug into a blue bottle.",
        changedBlobUrl: "https://blob.example/changed-a.png",
        changedBlobPath: "themes/changed-a.png",
        answerBox: { x: 0.2, y: 0.3, width: 0.18, height: 0.22 },
        changeSummary: "yellow mug becomes blue bottle",
      },
      sql,
    );
    const second = await createAhaChange(
      {
        themeId: theme.id,
        status: "approved",
        editPrompt: "Move the red spoon to the left side.",
        changedBlobUrl: "https://blob.example/changed-b.png",
        changedBlobPath: "themes/changed-b.png",
        answerBox: { x: 0.1, y: 0.2, width: 0.1, height: 0.1 },
        changeSummary: "red spoon moves left",
      },
      sql,
    );

    expect(first.themeId).toBe(theme.id);
    expect(second.themeId).toBe(theme.id);
    expect(first.id).not.toBe(second.id);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("lists only approved Aha changes joined to approved base themes", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        theme: themeRow(),
        change: changeRow(),
      },
    ]);
    const sql = { query };

    const rows = await listApprovedAhaChanges(
      {
        imageModel: "gemini",
        aspectRatio: "1:1",
        limit: 10,
      },
      sql,
    );

    const queryText = query.mock.calls[0]?.[0] as string;
    expect(queryText).toContain("i.status = 'approved'");
    expect(queryText).toContain("c.status = 'approved'");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.theme.gameMode).toBe("change");
    expect(rows[0]?.change.status).toBe("approved");
  });

  it("records feedback against the change pattern, not only the base theme", async () => {
    const query = vi.fn().mockResolvedValue([{ recorded: true }]);
    const sql = { query };

    await expect(
      recordAhaChangeFeedback(
        {
          changeId: "22222222-2222-2222-2222-222222222222",
          kind: "low_quality",
          roomId: "ROOM1",
          roundId: "round-1",
          uidHash: "user-hash",
        },
        sql,
      ),
    ).resolves.toEqual({ recorded: true });

    const queryText = query.mock.calls[0]?.[0] as string;
    expect(queryText).toContain("theme_catalog_change_feedback");
    expect(queryText).toContain("feedback_low_quality_count");
  });

  it("round-trips normalized answer boxes and rejects out-of-bounds values", () => {
    expect(
      normalizeAnswerBox({
        x: 0.25,
        y: 0.1,
        width: 0.2,
        height: 0.3,
      }),
    ).toEqual({
      x: 0.25,
      y: 0.1,
      width: 0.2,
      height: 0.3,
    });

    expect(() =>
      normalizeAnswerBox({
        x: 0.9,
        y: 0.1,
        width: 0.2,
        height: 0.3,
      }),
    ).toThrow("answerBox must be normalized within the image bounds.");
  });
});
