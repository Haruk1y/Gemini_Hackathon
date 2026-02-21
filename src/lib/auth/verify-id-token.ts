import { getAdminAuth } from "@/lib/firebase/admin";
import { AppError } from "@/lib/utils/errors";

export interface AuthContext {
  uid: string;
  token: string;
}

export async function verifyAuthHeader(
  authorizationHeader: string | null,
): Promise<AuthContext> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "Missing bearer token", false, 401);
  }

  const token = authorizationHeader.replace("Bearer ", "").trim();
  if (!token) {
    throw new AppError("UNAUTHORIZED", "Invalid bearer token", false, 401);
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid, token };
  } catch (error) {
    console.error("Token verification failed", error);
    throw new AppError("UNAUTHORIZED", "Token verification failed", false, 401);
  }
}
