import { roundSchema } from "@/lib/api/schemas";
import { withPostHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roundSchema, async () => {
  throw new AppError("VALIDATION_ERROR", "ヒント機能は現在無効です", false, 409);
});
