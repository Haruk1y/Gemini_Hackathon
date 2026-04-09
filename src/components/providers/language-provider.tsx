"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from "react";

import { getCopy, type AppCopy } from "@/lib/i18n/copy";
import { normalizeLanguage, type Language, writeLanguageCookie } from "@/lib/i18n/language";

interface LanguageContextValue {
  language: Language;
  setLanguage: Dispatch<SetStateAction<Language>>;
  copy: AppCopy;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  initialLanguage,
}: PropsWithChildren<{ initialLanguage: Language }>) {
  const [language, setLanguage] = useState<Language>(normalizeLanguage(initialLanguage));

  useEffect(() => {
    document.documentElement.lang = language;
    writeLanguageCookie(language);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      copy: getCopy(language),
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
}
