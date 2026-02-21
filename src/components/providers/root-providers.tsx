"use client";

import type { PropsWithChildren } from "react";

import { AuthProvider } from "@/components/providers/auth-provider";

export function RootProviders({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}
