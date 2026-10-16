import { Suspense } from "react";
import { LoginForm } from "@/app/login/login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-page text-[14px] text-muted">
          Loading login…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
