import type { Metadata } from "next";
import { JetBrains_Mono, Mochiy_Pop_One, Zen_Kaku_Gothic_New } from "next/font/google";

import { RootProviders } from "@/components/providers/root-providers";
import "./globals.css";

const displayFont = Mochiy_Pop_One({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
});

const bodyFont = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Prompt Mirror Battle",
  description: "マルチプレイ画像生成プロンプトクイズ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} bg-[var(--pmb-base)] font-sans text-[var(--pmb-ink)] antialiased`}
      >
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
