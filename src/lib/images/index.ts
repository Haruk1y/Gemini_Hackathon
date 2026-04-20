import {
  generateImage as generateGeminiImage,
} from "@/lib/gemini/client";
import { generateFluxImage } from "@/lib/images/flux-vertex";
import {
  type GeneratedImage,
} from "@/lib/images/types";
import {
  normalizeImageModel,
  type AspectRatio,
  type ImageModel,
} from "@/lib/types/game";

export type { GeneratedImage } from "@/lib/images/types";
export { imageToBuffer, imageToPublicUrl, placeholderImageUrl } from "@/lib/images/types";

export async function generateImage(params: {
  prompt: string;
  aspectRatio: AspectRatio;
  imageModel: ImageModel | "flash";
  sourceImage?: GeneratedImage;
}): Promise<GeneratedImage> {
  const imageModel = normalizeImageModel(params.imageModel, "gemini");

  if (imageModel === "flux") {
    return generateFluxImage({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      sourceImage: params.sourceImage,
    });
  }

  return generateGeminiImage({
    prompt: params.prompt,
    aspectRatio: params.aspectRatio,
    sourceImage: params.sourceImage,
  });
}
