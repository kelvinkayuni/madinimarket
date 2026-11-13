"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { StaffTaskType } from "@/lib/staff-task-claims";

type Claim = { fullName: string; mine: boolean; expiresAt: string };

export default function StaffTaskClaim({
  type,
  taskId,
  enabled = true,
  refreshOnMount = false,
  controlInChildren = false,
  compact = false,
  onNotice,
  children,
}: {
  type: StaffTaskType;
  taskId: string;
  enabled?: boolean;
  refreshOnMount?: boolean;
  controlInChildren?: boolean;
  compact?: boolean;
  onNotice: (message: string) => void;
  children: (claim: { canAct: boolean; control: ReactNode | null }) => ReactNode;
}) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (action?: "claim" | "release") => {
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Staff session expired. Sign in again.");
    const response = await fetch(action ? "/api/staff/task-claims" : `/api/staff/task-claims?type=${encodeURIComponent(type)}&id=${encodeURIComponent(taskId)}`, {
      method: action ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      ...(action ? { body: JSON.stringify({ type, id: taskId, action }) } : {}),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not update task availability.");
    setClaim(result.claim as Claim | null);
    return result.claim as Claim | null;
  }, [taskId, type]);

  useEffect(() => {
    if (!enabled || !claim?.mine) return;
    let active = true;
    const renew = async () => {
      try {
        await request("claim");
      } catch (error) {
        if (active) {
          onNotice(error instanceof Error ? error.message : "Could not refresh task availability.");
          try {
            await request();
          } catch (refreshError) {
            onNotice(refreshError instanceof Error ? refreshError.message : "Could not refresh task availability.");
          }
        }
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void renew();
    };
    const interval = window.setInterval(handleVisibility, 5 * 60_000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [claim?.mine, enabled, onNotice, request]);

  useEffect(() => {
    if (!enabled || !refreshOnMount) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void request().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not load task availability.");
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [enabled, onNotice, refreshOnMount, request]);

  const update = async (action: "claim" | "release") => {
    setBusy(true);
    try {
      await request(action);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update task availability.");
      try {
        await request();
      } catch (refreshError) {
        onNotice(refreshError instanceof Error ? refreshError.message : "Could not refresh task availability.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return children({ canAct: true, control: null });
  const taskControl = <div className={`admin-staff-row-actions${compact ? " support-task-claim-inline-actions" : ""}`}>
    {claim?.mine
      ? <><span title="You are handling this task">{compact ? "Claimed" : "You are handling this task"}</span><button className="button button-outline" type="button" aria-label="Release task" disabled={busy} onClick={() => void update("release")}>{busy ? "Updating…" : compact ? "Release" : "Release task"}</button></>
      : claim
        ? <><span title={`Being handled by ${claim.fullName}`}>{compact ? `With ${claim.fullName}` : `Being handled by ${claim.fullName}`}</span><button className="button button-outline" type="button" aria-label="Try to claim task" disabled={busy} onClick={() => void update("claim")}>{busy ? "Checking…" : compact ? "Try" : "Try claim"}</button></>
        : <button className="button button-outline" type="button" aria-label="Claim task" title="Claim task" disabled={busy} onClick={() => void update("claim")}>{busy ? "Claiming…" : compact ? "Claim" : "Claim task"}</button>}
  </div>;
  const claimControl = compact ? <div className="support-task-claim-inline">{taskControl}</div> : taskControl;
  if (controlInChildren) return children({ canAct: Boolean(claim?.mine) && !busy, control: claimControl });
  return <>{claimControl}{children({ canAct: Boolean(claim?.mine) && !busy, control: null })}</>;
}
