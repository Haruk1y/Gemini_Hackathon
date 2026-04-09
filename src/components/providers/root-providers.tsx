"use client";

import type { PropsWithChildren } from "react";

import { AuthProvider } from "@/components/providers/auth-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import type { Language } from "@/lib/i18n/language";

export function RootProviders({
  children,
  initialLanguage,
}: PropsWithChildren<{ initialLanguage: Language }>) {
  return (
    <LanguageProvider initialLanguage={initialLanguage}>
      <AuthProvider>{children}</AuthProvider>
    </LanguageProvider>
  );
}
