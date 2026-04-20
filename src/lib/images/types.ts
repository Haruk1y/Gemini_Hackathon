export interface GeneratedImage {
  mimeType: string;
  base64Data?: string;
  directUrl?: string;
}

export function placeholderImageUrl(label: string): string {
  const text = encodeURIComponent(label.trim().slice(0, 60) || "image");
  return `https://placehold.co/1024x1024/FFF7E6/101010/png?text=${text}`;
}

export function imageToBuffer(image: GeneratedImage): Buffer | null {
  if (!image.base64Data) {
    return null;
  }

  return Buffer.from(image.base64Data, "base64");
}

export function imageToPublicUrl(image: GeneratedImage): string | null {
  return image.directUrl ?? null;
}
