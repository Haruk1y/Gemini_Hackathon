import HomePageClient from "@/components/home/home-page-client";
import {
  resolveDefaultImageModel,
  resolveDefaultJudgeModel,
  resolveDefaultPromptModel,
} from "@/lib/game/defaults";

export default function HomePage() {
  return (
    <HomePageClient
      initialImageModel={resolveDefaultImageModel()}
      initialPromptModel={resolveDefaultPromptModel()}
      initialJudgeModel={resolveDefaultJudgeModel()}
    />
  );
}
