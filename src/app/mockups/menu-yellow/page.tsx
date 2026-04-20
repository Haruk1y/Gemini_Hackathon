import type { Metadata } from "next";

import { MenuYellowScreen } from "@/components/mockups/menu-yellow-screen";

export const metadata: Metadata = {
  title: "PrompDojo Yellow Menu Mockup",
  description:
    "PrompDojo party-show menu mockup inspired by the yellow Supercell-style spec.",
};

export default function MockupMenuYellowPage() {
  return <MenuYellowScreen />;
}
