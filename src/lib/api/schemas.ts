import { z } from "zod";

const safeDisplayName = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}_\-\s]+$/u, "Display name includes invalid characters");

export const roomSettingsSchema = z
  .object({
    maxPlayers: z.number().int().min(2).max(10),
    roundSeconds: z.number().int().min(60).max(120),
    maxAttempts: z.number().int().min(1).max(5),
    aspectRatio: z.enum(["1:1", "16:9", "9:16"]),
    hintLimit: z.number().int().min(0).max(2),
    totalRounds: z.number().int().min(1).max(5).default(3),
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

export const submitSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
  prompt: z.string().trim().min(8).max(600),
});

export const roundSchema = z.object({
  roomId: z.string().trim().min(1),
  roundId: z.string().trim().min(1),
});
