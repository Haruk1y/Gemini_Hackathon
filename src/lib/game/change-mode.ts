import { PNG } from "pngjs";

import type { GeneratedImage } from "@/lib/images";
import type {
  ChangeRoundPrivateState,
  ChangeRoundResult,
  ChangeSubmission,
  NormalizedBox,
  NormalizedPoint,
  PlayerDoc,
} from "@/lib/types/game";

export const CHANGE_MIN_PLAYERS = 2;
export const CHANGE_SCORE_FLOOR = 20;
export const CHANGE_SCORE_STEP = 20;
export const CHANGE_SCORE_START = 100;
const MOCK_IMAGE_SIZE = 128;

export function resolveChangeGuessScore(rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) {
    return 0;
  }

  return Math.max(
    CHANGE_SCORE_FLOOR,
    CHANGE_SCORE_START - (Math.floor(rank) - 1) * CHANGE_SCORE_STEP,
  );
}

export function isPointInsideNormalizedBox(
  point: NormalizedPoint,
  box: NormalizedBox,
): boolean {
  return (
    point.x >= box.x &&
    point.y >= box.y &&
    point.x <= box.x + box.width &&
    point.y <= box.y + box.height
  );
}

export function listHumanPlayers(players: Record<string, PlayerDoc>): PlayerDoc[] {
  return Object.values(players)
    .filter((player) => player.kind === "human")
    .sort((a, b) => {
      const seatA =
        typeof a.seatOrder === "number" ? a.seatOrder : Number.MAX_SAFE_INTEGER;
      const seatB =
        typeof b.seatOrder === "number" ? b.seatOrder : Number.MAX_SAFE_INTEGER;

      if (seatA !== seatB) {
        return seatA - seatB;
      }

      return a.joinedAt.getTime() - b.joinedAt.getTime();
    });
}

export function countSubmittedChangeGuesses(
  state: ChangeRoundPrivateState,
): number {
  return Object.keys(state.submissionsByUid).length;
}

export function countCorrectChangeGuesses(
  state: ChangeRoundPrivateState,
): number {
  return Object.values(state.submissionsByUid).filter((item) => item.hit).length;
}

export function buildChangeRoundResults(params: {
  players: Record<string, PlayerDoc>;
  privateState: ChangeRoundPrivateState;
}): ChangeRoundResult[] {
  const submissionsByUid = params.privateState.submissionsByUid;

  return listHumanPlayers(params.players).map((player) => {
    const submission = submissionsByUid[player.uid];

    if (!submission) {
      return {
        uid: player.uid,
        displayName: player.displayName,
        kind: player.kind,
        submitted: false,
        point: null,
        hit: false,
        score: 0,
        rank: null,
      };
    }

    return {
      uid: submission.uid,
      displayName: submission.displayName,
      kind: submission.kind,
      submitted: true,
      point: submission.point,
      hit: submission.hit,
      score: submission.score,
      rank: submission.rank,
      createdAt: submission.createdAt,
    };
  });
}

export function createMockChangeRoundAssets(): {
  baseImage: GeneratedImage;
  changedImage: GeneratedImage;
  answerBox: NormalizedBox;
  changeSummary: string;
} {
  const answerBox: NormalizedBox = {
    x: 0.56,
    y: 0.36,
    width: 0.16,
    height: 0.26,
  };

  const basePng = new PNG({ width: MOCK_IMAGE_SIZE, height: MOCK_IMAGE_SIZE });
  const changedPng = new PNG({ width: MOCK_IMAGE_SIZE, height: MOCK_IMAGE_SIZE });
  paintMockScene(basePng, false);
  paintMockScene(changedPng, true);

  return {
    baseImage: {
      mimeType: "image/png",
      directUrl: pngToDataUrl(basePng),
    },
    changedImage: {
      mimeType: "image/png",
      directUrl: pngToDataUrl(changedPng),
    },
    answerBox,
    changeSummary: "yellow mug becomes blue bottle",
  };
}

export function createChangeSubmission(params: {
  player: PlayerDoc;
  point: NormalizedPoint;
  hit: boolean;
  rank: number | null;
  now?: Date;
}): ChangeSubmission {
  return {
    uid: params.player.uid,
    displayName: params.player.displayName,
    kind: params.player.kind,
    point: params.point,
    hit: params.hit,
    score:
      params.hit && params.rank !== null
        ? resolveChangeGuessScore(params.rank)
        : 0,
    rank: params.hit ? params.rank : null,
    createdAt: params.now ?? new Date(),
  };
}

function pngToDataUrl(png: PNG): string {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function paintMockScene(png: PNG, changed: boolean) {
  fillRect(png, 0, 0, png.width, png.height, [244, 236, 220, 255]);
  fillRect(png, 0, 78, png.width, 50, [215, 190, 160, 255]);
  fillRect(png, 18, 26, 22, 34, [196, 158, 118, 255]);
  fillRect(png, 44, 30, 20, 28, [90, 126, 90, 255]);
  fillRect(png, 78, 20, 28, 18, [168, 95, 82, 255]);
  fillRect(png, 72, 72, 16, 16, [174, 124, 74, 255]);
  fillRect(png, 96, 76, 18, 12, [142, 110, 90, 255]);

  if (changed) {
    fillRect(png, 72, 46, 10, 22, [64, 120, 214, 255]);
    fillRect(png, 74, 42, 6, 6, [64, 120, 214, 255]);
  } else {
    fillRect(png, 72, 48, 18, 14, [229, 184, 62, 255]);
    fillRect(png, 88, 50, 4, 8, [229, 184, 62, 255]);
  }
}

function fillRect(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: [number, number, number, number],
) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = (png.width * row + col) * 4;
      png.data[offset] = rgba[0];
      png.data[offset + 1] = rgba[1];
      png.data[offset + 2] = rgba[2];
      png.data[offset + 3] = rgba[3];
    }
  }
}
