"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient, SUPABASE_PASSWORD_RECOVERY_KEY, SUPABASE_PASSWORD_RECOVERY_LIFETIME } from "@/lib/supabase";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(!token);

  useEffect(() => {
    if (token) return;
    let active = true;
    const markRecoveryReady = () => {
      if (!active) return;
      window.sessionStorage.setItem(SUPABASE_PASSWORD_RECOVERY_KEY, String(Date.now()));
      setRecoveryReady(true);
      setCheckingRecovery(false);
    };
    const recoveryInUrl = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery" ||
      new URLSearchParams(window.location.search).get("type") === "recovery";
    if (recoveryInUrl) window.sessionStorage.setItem(SUPABASE_PASSWORD_RECOVERY_KEY, String(Date.now()));

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" && session) markRecoveryReady();
      });
      void supabase.auth.getSession().then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) throw sessionError;
        const issuedAt = Number(window.sessionStorage.getItem(SUPABASE_PASSWORD_RECOVERY_KEY));
        if (data.session && issuedAt && Date.now() - issuedAt < SUPABASE_PASSWORD_RECOVERY_LIFETIME) {
          setRecoveryReady(true);
        } else if (issuedAt) {
          window.sessionStorage.removeItem(SUPABASE_PASSWORD_RECOVERY_KEY);
        }
        setCheckingRecovery(false);
      }).catch((sessionError: unknown) => {
        if (!active) return;
        setError(sessionError instanceof Error ? sessionError.message : "Could not verify the password reset link.");
        setCheckingRecovery(false);
      });
      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch (sessionError) {
      window.queueMicrotask(() => {
        if (!active) return;
        setError(sessionError instanceof Error ? sessionError.message : "Could not verify the password reset link.");
        setCheckingRecovery(false);
      });
      return () => { active = false; };
    }
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (token) {
        const response = await fetch("/api/auth/website-password-reset/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not update your password.");
        setMessage(result.message);
      } else {
        if (!recoveryReady) throw new Error("Open a valid password recovery link from your email to continue.");
        const { data, error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password });
        if (updateError) throw updateError;
        if (!data.user) throw new Error("Could not verify the account for this password reset.");
        window.sessionStorage.removeItem(SUPABASE_PASSWORD_RECOVERY_KEY);
        setMessage("Your password has been updated. You can continue to Madinimarket.");
      }
      formElement.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="password-reset-page">
      <section className="password-reset-card">
        <div className="dialog-kicker">MADINIMARKET ACCOUNT</div>
        <h1>Choose a new password</h1>
        <p className="dialog-copy">Set a new password for your account. Passwords must be at least 8 characters.</p>
        {message ? (
          <div role="status">
            <p className="password-reset-message">{message}</p>
            <Link className="button button-dark form-submit password-reset-link" href="/">Return to Madinimarket</Link>
          </div>
        ) : !token && checkingRecovery ? (
          <p className="dialog-copy" role="status">Verifying your password recovery link…</p>
        ) : !token && !recoveryReady ? (
          <p className="password-reset-error" role="alert">This reset link is missing or invalid. Request a new one from the sign-in window.</p>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            <label className="field-label">New password<input className="text-input" name="password" type="password" minLength={8} maxLength={256} autoComplete="new-password" required /></label>
            <label className="field-label">Confirm new password<input className="text-input" name="confirmation" type="password" minLength={8} maxLength={256} autoComplete="new-password" required /></label>
            {error && <p className="password-reset-error" role="alert">{error}</p>}
            <button className="button button-dark form-submit" type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
