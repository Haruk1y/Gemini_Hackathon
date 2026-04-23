import { z } from "zod";

export const gmPromptSchema = z.object({
  title: z.string().min(3).max(80),
  difficulty: z.number().int().min(1).max(5),
  tags: z.array(z.string().min(1)).min(2).max(6),
  prompt: z.string().min(30).max(500),
  negativePrompt: z.string().max(300).optional(),
  mustInclude: z.array(z.string().min(1)).max(5).default([]),
  mustAvoid: z.array(z.string().min(1)).max(5).default([]),
});

export const captionSchema = z.object({
  scene: z.string().min(3).max(240),
  mainSubjects: z.array(z.string()).min(1).max(8),
  keyObjects: z.array(z.string()).max(10),
  colors: z.array(z.string()).max(8),
  style: z.string().min(3).max(200),
  composition: z.string().min(3).max(200),
  textInImage: z.string().nullable(),
});

export const visualScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  matchedElements: z.array(z.string().min(1)).max(6).default([]),
  missingElements: z.array(z.string().min(1)).max(6).default([]),
  note: z.string().max(240).default(""),
});

export const changeEditPlanSchema = z.object({
  summary: z.string().min(3).max(120),
  editPrompt: z.string().min(40).max(500),
});

export const singleChangeValidationSchema = z.object({
  valid: z.boolean(),
  changedObject: z.string().max(80).default(""),
  note: z.string().max(200).default(""),
});

export type GmPromptSchema = z.infer<typeof gmPromptSchema>;
export type CaptionSchema = z.infer<typeof captionSchema>;
export type VisualScoreSchema = z.infer<typeof visualScoreSchema>;
export type ChangeEditPlanSchema = z.infer<typeof changeEditPlanSchema>;
export type SingleChangeValidationSchema = z.infer<
  typeof singleChangeValidationSchema
>;
