"use client";

import { Toaster } from "sonner";
import { AuthProvider } from "@/components/auth/auth-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          className: "font-sans",
        }}
      />
    </AuthProvider>
  );
}
