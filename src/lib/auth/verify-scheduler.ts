import { OAuth2Client } from "google-auth-library";

import { AppError } from "@/lib/utils/errors";

const oauthClient = new OAuth2Client();

export function resolveSchedulerAudience(request: Request): string {
  return (
    process.env.SCHEDULER_OIDC_AUDIENCE ??
    process.env.APP_BASE_URL ??
    new URL(request.url).origin
  );
}

function schedulerProtectionEnabled(request: Request): boolean {
  return Boolean(
    request.headers.get("authorization") ||
      process.env.SCHEDULER_OIDC_AUDIENCE ||
      process.env.APP_BASE_URL,
  );
}

export async function verifySchedulerRequest(request: Request): Promise<void> {
  if (!schedulerProtectionEnabled(request)) {
    return;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "Missing Cloud Scheduler token", false, 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const audience = resolveSchedulerAudience(request);

  try {
    await oauthClient.verifyIdToken({
      idToken: token,
      audience,
    });
  } catch (error) {
    console.error("Cloud Scheduler token verification failed", error);
    throw new AppError("UNAUTHORIZED", "Invalid Cloud Scheduler token", false, 401);
  }
}

export const __test__ = {
  schedulerProtectionEnabled,
};
