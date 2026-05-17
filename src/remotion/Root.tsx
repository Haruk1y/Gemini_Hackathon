import { Composition } from "remotion";

import {
  FPS,
  PROMPDOJO_DURATION_FRAMES,
  PrompDojoIntro,
} from "./PrompDojoIntro";

export const RemotionRoot = () => {
  return (
    <Composition
      id="PrompDojoIntro"
      component={PrompDojoIntro}
      durationInFrames={PROMPDOJO_DURATION_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
