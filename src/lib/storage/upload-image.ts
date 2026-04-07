import { getAdminStorage, getStorageBucketName } from "@/lib/google-cloud/admin";

interface UploadParams {
  path: string;
  buffer: Buffer;
  mimeType: string;
}

export async function uploadImageToStorage({
  path,
  buffer,
  mimeType,
}: UploadParams): Promise<string> {
  const bucket = getAdminStorage().bucket(getStorageBucketName());
  const file = bucket.file(path);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "2500-01-01",
  });

  return url;
}
