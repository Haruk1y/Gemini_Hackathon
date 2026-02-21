import { customAlphabet } from "nanoid";

const roomIdAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateCode = customAlphabet(roomIdAlphabet, 6);

export function createRoomCode(): string {
  return generateCode();
}
