"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export default function StaffActivationForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingInvitation, setCheckingInvitation] = useState(isSupabaseConfigured);
  const [notice, setNotice] = useState(isSupabaseConfigured ? "" : "Staff sign-in is not configured.");

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured) return () => { active = false; };
    let redirecting = false;
    const verifyInvitation = async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient().auth.getSession();
        if (!active) return;
        if (error) {
          setNotice("Could not verify the invitation link. Please request a new invitation.");
          return;
        }
        if (!data.session) {
          setNotice("This invitation link is invalid or expired. Please ask the administrator to send a new one.");
          return;
        }
        const response = await fetch("/api/staff/access", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
        });
        if (!active) return;
        if (response.ok) {
          redirecting = true;
          router.replace("/");
          return;
        }
        if (response.status === 403) {
          setReady(true);
          return;
        }
        setNotice("Could not verify the staff account status. Please try again or ask the administrator for help.");
      } catch {
        if (active) setNotice("Could not verify the invitation link. Please request a new invitation.");
      } finally {
        if (active && !redirecting) setCheckingInvitation(false);
      }
    };
    void verifyInvitation();
    return () => { active = false; };
  }, [router]);

  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 12 || password.length > 256) {
      setNotice("Choose a password with at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setNotice("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (!data.user) throw new Error("Could not verify the activated staff account.");
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Invitation session expired. Ask the administrator to send a new invitation.");
      const response = await fetch("/api/staff/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not activate the staff account.");
      setNotice("Your staff account is ready. Opening your order work queue…");
      window.setTimeout(() => router.replace("/"), 700);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not activate your staff account.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="staff-activation-shell">
    {checkingInvitation ? <section className="dialog-card staff-activation-card" role="status" aria-live="polite">
      <div className="dialog-kicker">MADINIMARKET STAFF</div>
      <h1>Checking your invitation</h1>
      <p className="dialog-copy">Please wait while we verify your staff account.</p>
    </section> : <form className="dialog-card staff-activation-card" onSubmit={(event) => void activate(event)}>
      <div className="dialog-kicker">MADINIMARKET STAFF</div>
      <h1>Set your password</h1>
      <p className="dialog-copy">Create a private password for your individual staff account. Use at least 12 characters and don’t share it.</p>
      <label className="field-label">New password<input className="text-input" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={!ready || busy} /></label>
      <label className="field-label">Confirm password<input className="text-input" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={!ready || busy} /></label>
      {notice && <p className="commerce-note" role="status">{notice}</p>}
      <button className="button button-dark" type="submit" disabled={!ready || busy}>{busy ? "Saving…" : "Save password and continue"}</button>
    </form>}
  </main>;
}
