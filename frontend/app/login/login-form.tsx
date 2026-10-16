"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/components/auth/auth-provider";

const inputClass =
  "mt-1.5 w-full rounded-btn border border-divider bg-white px-3 py-2.5 text-[14px] text-heading outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

export function LoginForm() {
  const searchParams = useSearchParams();
  const { login, register } = useAuth();
  const next = searchParams.get("next") ?? undefined;
  const staffLogin = searchParams.get("audience") === "staff";

  const [creatingAccount, setCreatingAccount] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (creatingAccount) {
        await register({ fullName, email, phone, password }, next);
        toast.success("Your patient account has been created.");
      } else {
        await login(email, password, next);
        toast.success("You are signed in.");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sign-in failed. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[480px] rounded-panel border border-divider bg-white p-8 shadow-raised">
        <Logo subtitle="Dental Clinic" />
        <h1 className="mt-6 font-heading text-[28px] font-bold text-heading">
          {creatingAccount ? "Create a patient account" : staffLogin ? "Clinic sign in" : "Welcome back"}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {creatingAccount
            ? "Register to book appointments and keep track of your visits."
            : staffLogin
              ? "Sign in to the clinic administrator and dentist workspace."
              : "Sign in to your patient account or create one to book an appointment."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {creatingAccount ? (
            <>
              <label className="block text-[13px] font-medium text-heading">
                Full name
                <input
                  autoComplete="name"
                  className={inputClass}
                  maxLength={120}
                  minLength={2}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  value={fullName}
                />
              </label>
              <label className="block text-[13px] font-medium text-heading">
                Phone number
                <input
                  autoComplete="tel"
                  className={inputClass}
                  onChange={(event) => setPhone(event.target.value)}
                  required
                  type="tel"
                  value={phone}
                />
              </label>
            </>
          ) : null}

          <label className="block text-[13px] font-medium text-heading">
            Email
            <input
              autoComplete="email"
              className={inputClass}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block text-[13px] font-medium text-heading">
            Password
            <input
              autoComplete={creatingAccount ? "new-password" : "current-password"}
              className={inputClass}
              minLength={creatingAccount ? 8 : undefined}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {error ? (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-btn bg-primary px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
          >
            {submitting
              ? "Please wait…"
              : creatingAccount
                ? "Create patient account"
                : "Sign in"}
          </button>
        </form>

        {!staffLogin ? (
          <p className="mt-5 text-center text-[13px] text-muted">
            {creatingAccount ? "Already have an account?" : "New to the clinic?"}{" "}
            <button
              type="button"
              onClick={() => {
                setCreatingAccount((current) => !current);
                setError("");
              }}
              className="font-semibold text-primary hover:underline"
            >
              {creatingAccount ? "Sign in" : "Create a patient account"}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
