"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      const response = await fetch("/api/auth/website-password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update your password.");
      setMessage(result.message);
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
        <p className="dialog-copy">Set a new password for your buyer or seller account. Passwords must be at least 8 characters.</p>
        {message ? (
          <div role="status">
            <p className="password-reset-message">{message}</p>
            <Link className="button button-dark form-submit password-reset-link" href="/">Return to Madinimarket</Link>
          </div>
        ) : !token ? (
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
