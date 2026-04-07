import { roomSettingsUpdateSchema } from "@/lib/api/schemas";
import { withPostHandler, ok } from "@/lib/api/handler";
import { updateRoomSettings } from "@/lib/game/room-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withPostHandler(roomSettingsUpdateSchema, async ({ body, auth }) => {
  const settings = await updateRoomSettings({
    roomId: body.roomId,
    uid: auth.uid,
    settings: body.settings,
  });

  return ok({ settings });
});
