import { getAdminDb } from "@/lib/firebase/admin";
import { roundSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { attemptPrivateRef } from "@/lib/api/paths";
import { assertRoundOpen } from "@/lib/game/round-validation";
import { generateHint, generateImage, imageToBuffer, imageToPublicUrl } from "@/lib/gemini/client";
import { uploadImageToStorage } from "@/lib/storage/upload-image";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roundSchema, async ({ body, auth }) => {
  const { room, roundPrivate } = await assertRoundOpen({
    roomId: body.roomId,
    roundId: body.roundId,
    uid: auth.uid,
  });

  const attemptRef = attemptPrivateRef(body.roomId, body.roundId, auth.uid);
  const attemptSnapshot = await attemptRef.get();

  if (!attemptSnapshot.exists) {
    throw new AppError("VALIDATION_ERROR", "No attempts yet for hint generation", false, 409);
  }

  const attemptData = attemptSnapshot.data() as {
    hintUsed: number;
    attempts: Array<{
      prompt: string;
      captionText: string;
      imageUrl: string;
      attemptNo: number;
    }>;
  };

  if ((attemptData.hintUsed ?? 0) >= room.settings.hintLimit) {
    throw new AppError("HINT_LIMIT_REACHED", "Hint limit reached", false, 409);
  }

  if (!attemptData.attempts?.length) {
    throw new AppError("VALIDATION_ERROR", "Submit at least one attempt first", false, 409);
  }

  const latest = attemptData.attempts[attemptData.attempts.length - 1];

  const hint = await generateHint({
    targetCaption: roundPrivate.targetCaptionText,
    latestCaption: latest.captionText,
    latestPrompt: latest.prompt,
  });

  const hintImage = await generateImage({
    prompt: hint.improvedPrompt,
    aspectRatio: room.settings.aspectRatio,
  });

  const hintBuffer = imageToBuffer(hintImage);
  let hintImageUrl = imageToPublicUrl(hintImage, hint.improvedPrompt);

  if (hintBuffer) {
    hintImageUrl = await uploadImageToStorage({
      path: `rooms/${body.roomId}/rounds/${body.roundId}/players/${auth.uid}/hint.png`,
      buffer: hintBuffer,
      mimeType: hintImage.mimeType,
    });
  }

  if (!hintImageUrl) {
    throw new AppError("GEMINI_ERROR", "Failed to create hint image", true, 502);
  }

  await getAdminDb().runTransaction(async (tx) => {
    const snapshot = await tx.get(attemptRef);
    if (!snapshot.exists) {
      throw new AppError("INTERNAL_ERROR", "Attempts document missing", true, 500);
    }

    const data = snapshot.data() as {
      hintUsed: number;
    };

    if ((data.hintUsed ?? 0) >= room.settings.hintLimit) {
      throw new AppError("HINT_LIMIT_REACHED", "Hint limit reached", false, 409);
    }

    tx.update(attemptRef, {
      hintUsed: (data.hintUsed ?? 0) + 1,
      updatedAt: new Date(),
    });
  });

  return ok({
    hint,
    hintImageUrl,
  });
});
