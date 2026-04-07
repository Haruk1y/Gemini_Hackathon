import { del, list, put } from "@vercel/blob";

import { AppError } from "@/lib/utils/errors";

interface UploadParams {
  path: string;
  buffer: Buffer;
  mimeType: string;
}

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function assertBlobTokenConfigured() {
  if (hasBlobToken()) {
    return;
  }

  console.error("BLOB_READ_WRITE_TOKEN is missing for Blob upload");
  throw new AppError(
    "INTERNAL_ERROR",
    "BLOB_READ_WRITE_TOKEN is missing",
    false,
    500,
  );
}

export async function uploadImageToStorage({
  path,
  buffer,
  mimeType,
}: UploadParams): Promise<string> {
  assertBlobTokenConfigured();

  const blob = await put(path, buffer, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: mimeType,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });

  return blob.url;
}

export async function deleteStoragePrefix(prefix: string): Promise<void> {
  if (!hasBlobToken()) {
    return;
  }

  let cursor: string | undefined;
  do {
    const result = await list({
      prefix,
      cursor,
      limit: 1000,
    });

    if (result.blobs.length > 0) {
      await del(result.blobs.map((blob) => blob.pathname));
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
}

export const __test__ = {
  assertBlobTokenConfigured,
};
