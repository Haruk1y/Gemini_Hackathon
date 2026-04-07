import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface GoogleCloudCredentials {
  client_email: string;
  private_key: string;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseServiceAccountKeyJson(value: string): {
  projectId?: string;
  credentials: GoogleCloudCredentials;
} {
  const parsed = JSON.parse(value) as {
    project_id?: unknown;
    client_email?: unknown;
    private_key?: unknown;
  };

  if (
    typeof parsed.client_email !== "string" ||
    typeof parsed.private_key !== "string"
  ) {
    throw new Error(
      "GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON is missing client_email or private_key",
    );
  }

  return {
    projectId: typeof parsed.project_id === "string" ? parsed.project_id : undefined,
    credentials: {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    },
  };
}

function buildGoogleCloudClientOptions(): {
  projectId?: string;
  credentials?: GoogleCloudCredentials;
} {
  const serviceAccountJson = optionalEnv("GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY_JSON");
  if (serviceAccountJson) {
    const parsed = parseServiceAccountKeyJson(serviceAccountJson);
    return {
      projectId: optionalEnv("GOOGLE_CLOUD_PROJECT") ?? parsed.projectId,
      credentials: parsed.credentials,
    };
  }

  return {
    projectId: optionalEnv("GOOGLE_CLOUD_PROJECT") ?? undefined,
  };
}

let firestore: Firestore | null = null;
let storage: Storage | null = null;

export function getAdminDb(): Firestore {
  if (!firestore) {
    const options = buildGoogleCloudClientOptions();
    firestore = new Firestore({
      ...options,
      ignoreUndefinedProperties: true,
    });
  }

  return firestore;
}

export function getAdminStorage(): Storage {
  if (!storage) {
    storage = new Storage(buildGoogleCloudClientOptions());
  }

  return storage;
}

export function getStorageBucketName(): string {
  return process.env.GCS_BUCKET ?? requiredEnv("GCS_BUCKET");
}

export const __test__ = {
  buildGoogleCloudClientOptions,
  parseServiceAccountKeyJson,
};
