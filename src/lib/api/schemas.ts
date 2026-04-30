import { z } from "zod";

const safeDisplayName = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[\p{L}\p{N}_\-\s]+$/u, "Display name includes invalid characters");

export const gameModeSchema = z.enum([
  "classic",
  "memory",
  "change",
  "impostor",
]);
export const imageModelSchema = z.enum(["gemini", "flux"]);
export const textModelVariantSchema = z.enum(["flash", "flash-lite"]);

export const roomSettingsSchema = z
  .object({
    maxPlayers: z.number().int().min(2).max(10),
    roundSeconds: z.number().int().min(15).max(100),
    maxAttempts: z.number().int().min(1).max(1),
    aspectRatio: z.enum(["1:1", "16:9", "9:16"]),
    imageModel: imageModelSchema,
    promptModel: textModelVariantSchema,
    judgeModel: textModelVariantSchema,
    hintLimit: z.number().int().min(0).max(0),
    totalRounds: z.number().int().min(1).max(3).default(1),
    gameMode: gameModeSchema,
    cpuCount: z.number().int().min(0).max(6).default(0),
  })
  .partial();

export const createRoomSchema = z.object({
  displayName: safeDisplayName,
  settings: roomSettingsSchema.optional(),
});

export const joinRoomSchema = z.object({
  code: z.string().trim().length(6).toUpperCase(),
  displayName: safeDisplayName,
});

export const readySchema = z.object({
  roomId: z.string().trim().min(1),
  ready: z.boolean(),
});

export const roomOnlySchema = z.object({
  roomId: z.string().trim().min(1),
});

export const roomSettingsUpdateSchema = z.object({
  roomId: z.string().trim().min(1),
  settings: z.object({
    gameMode: gameModeSchema,
    totalRounds: z.number().int().min(1).max(3),
    roundSeconds: z.number().int().min(15).max(100),
    cpuCount: z.number().int().min(0).max(6),
  }),
});

export const submitSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(600),
});

export const roundSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
});

export const clickSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const endRoundIfNeededSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
  draftPrompt: z.string().max(600).optional(),
  forceResults: z.boolean().optional(),
});

export const voteSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
  targetUid: z.string().trim().min(1),
});
