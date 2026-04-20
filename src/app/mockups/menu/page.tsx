import type { Metadata } from "next";

import { MenuScreen } from "@/components/mockups/menu-screen";

export const metadata: Metadata = {
  title: "PrompDojo Menu Mockup",
  description: "PrompDojo initial menu screen mockup inspired by AI Art Impostor.",
};

export default function MockupMenuPage() {
  return <MenuScreen />;
}
