import { NextRequest, NextResponse } from "next/server";

import { verifySessionCookie } from "@/lib/auth/verify-session";
import {
  buildRoomViewSnapshot,
  type RoomViewName,
} from "@/lib/realtime/views";
import { AppError, toErrorResponse } from "@/lib/utils/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 15000;

function writeSseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeHeartbeat(): Uint8Array {
  return encoder.encode(": keep-alive\n\n");
}

function parseView(value: string | null): RoomViewName {
  if (
    value === "lobby" ||
    value === "round" ||
    value === "results" ||
    value === "transition"
  ) {
    return value;
  }

  throw new AppError("VALIDATION_ERROR", "Invalid room events view", false, 400);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;
    const auth = verifySessionCookie(request.cookies);
    const view = parseView(request.nextUrl.searchParams.get("view"));
    let closeConnection: (() => void) | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        let publishing = false;
        let republish = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

        const close = () => {
          if (closed) return;
          closed = true;
          if (pollTimer) {
            clearInterval(pollTimer);
          }
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
          }
          console.info("SSE disconnect", { roomId, uid: auth.uid, view });
          controller.close();
        };
        closeConnection = close;

        const publishSnapshot = async () => {
          if (closed) return;
          if (publishing) {
            republish = true;
            return;
          }

          publishing = true;
          try {
            const snapshot = await buildRoomViewSnapshot({
              roomId,
              uid: auth.uid,
              view,
            });
            if (!closed) {
              controller.enqueue(writeSseEvent("snapshot", snapshot));
            }
          } catch (error) {
            console.error("SSE snapshot build failed", {
              roomId,
              uid: auth.uid,
              view,
              error,
            });
            if (!closed) {
              controller.enqueue(
                writeSseEvent("error", {
                  message:
                    error instanceof Error ? error.message : "Failed to build room snapshot",
                }),
              );
            }
          } finally {
            publishing = false;
            if (republish) {
              republish = false;
              void publishSnapshot();
            }
          }
        };

        pollTimer = setInterval(() => {
          void publishSnapshot();
        }, POLL_INTERVAL_MS);

        heartbeatTimer = setInterval(() => {
          if (!closed) {
            controller.enqueue(writeHeartbeat());
          }
        }, HEARTBEAT_INTERVAL_MS);

        request.signal.addEventListener("abort", close);

        console.info("SSE connect", { roomId, uid: auth.uid, view });
        await publishSnapshot();
      },
      cancel() {
        closeConnection?.();
        console.info("SSE cancelled", { roomId, uid: auth.uid, view });
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
