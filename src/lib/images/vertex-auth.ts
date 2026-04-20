import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient, GoogleAuth } from "google-auth-library";

import { AppError } from "@/lib/utils/errors";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const adcAuth = new GoogleAuth({
  scopes: [CLOUD_PLATFORM_SCOPE],
});

class VercelOidcSupplier {
  async getSubjectToken(): Promise<string> {
    return getVercelOidcToken();
  }
}

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getRequiredEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}

function normalizeGoogleAuthError(error: unknown): AppError | null {
  if (error instanceof AppError) {
    return error;
  }

  const message = extractErrorText(error);

  if (
    /invalid_rapt|invalid_grant|reauthentication failed|application-default login|could not load the default credentials|default credentials were not found|getVercelOidcToken|OIDC token|oidc/i.test(
      message,
    )
  ) {
    return new AppError(
      "GCP_ERROR",
      "Google Cloud 認証の期限が切れています。`gcloud auth application-default login` を実行してから再試行してください。",
      false,
      503,
    );
  }

  return null;
}

function extractAuthorizationHeader(headers: Headers | Record<string, string>): string {
  const authorization =
    headers instanceof Headers
      ? headers.get("authorization")
      : headers.Authorization ?? headers.authorization;

  if (!authorization) {
    throw new Error("Failed to acquire Google access token.");
  }

  return authorization;
}

export function hasVercelWifConfig(): boolean {
  return Boolean(
    getEnv("GCP_PROJECT_NUMBER") &&
      getEnv("GCP_SERVICE_ACCOUNT_EMAIL") &&
      getEnv("GCP_WORKLOAD_IDENTITY_POOL_ID") &&
      getEnv("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"),
  );
}

export async function getGoogleCloudAuthorizationHeader(): Promise<string> {
  try {
    if (hasVercelWifConfig()) {
      const client = ExternalAccountClient.fromJSON({
        type: "external_account",
        audience: `//iam.googleapis.com/projects/${getRequiredEnv(
          "GCP_PROJECT_NUMBER",
        )}/locations/global/workloadIdentityPools/${getRequiredEnv(
          "GCP_WORKLOAD_IDENTITY_POOL_ID",
        )}/providers/${getRequiredEnv("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID")}`,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        token_url: "https://sts.googleapis.com/v1/token",
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${getRequiredEnv(
          "GCP_SERVICE_ACCOUNT_EMAIL",
        )}:generateAccessToken`,
        subject_token_supplier: new VercelOidcSupplier(),
        scopes: [CLOUD_PLATFORM_SCOPE],
      });

      if (!client) {
        throw new Error("Failed to initialize Google Cloud WIF auth client.");
      }

      const headers = await client.getRequestHeaders();
      return extractAuthorizationHeader(headers);
    }

    const client = await adcAuth.getClient();
    const headers = await client.getRequestHeaders();
    return extractAuthorizationHeader(headers);
  } catch (error) {
    throw normalizeGoogleAuthError(error) ?? error;
  }
}
