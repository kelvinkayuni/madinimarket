"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { STAFF_PERMISSION_OPTIONS, type StaffPermission } from "@/lib/staff-permissions";

type StaffRole = {
  id: number;
  name: string;
  permissions: StaffPermission[];
};

type StaffMember = {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  username: string;
  roles: StaffRole[];
  status: "invited" | "active" | "suspended";
  created_at: string;
};
type StaffAudit = {
  id: number;
  actor_username: string;
  action: string;
  entity_id: string | null;
  created_at: string;
};

export default function AdminStaffManagement({ onNotice }: { onNotice: (message: string) => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [audit, setAudit] = useState<StaffAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editingRolesFor, setEditingRolesFor] = useState<number | null>(null);
  const [roleSelections, setRoleSelections] = useState<Record<number, number[]>>({});

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) throw new Error("The staff service is not connected.");
    const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("Administrator session expired.");
    const response = await fetch("/api/admin/staff", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load staff.");
    setStaff(result.staff as StaffMember[]);
    setRoles(result.roles as StaffRole[]);
    setAudit(result.audit as StaffAudit[]);
  }, []);

  useEffect(() => {
    let active = true;
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not load staff.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
    };
  }, [load, onNotice]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy("invite");
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: values.get("fullName"),
          email: values.get("email"),
          roleIds: values.getAll("roleIds").map(Number),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not invite staff.");
      form.reset();
      await load();
      onNotice(`Invitation sent to ${result.staff.email}. Their employee ID is ${result.staff.employee_code}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not invite staff.");
    } finally {
      setBusy("");
    }
  };

  const createRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy("role");
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_role",
          name: values.get("roleName"),
          permissions: values.getAll("permissions"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create the role.");
      form.reset();
      await load();
      onNotice(`Staff role “${result.role.name}” created.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not create the role.");
    } finally {
      setBusy("");
    }
  };

  const saveRoles = async (member: StaffMember) => {
    setBusy(`roles-${member.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: member.id, roleIds: roleSelections[member.id] ?? [] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update staff roles.");
      setEditingRolesFor(null);
      await load();
      onNotice(`Roles updated for ${member.full_name}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update staff roles.");
    } finally {
      setBusy("");
    }
  };

  const changeStatus = async (member: StaffMember) => {
    const nextStatus = member.status === "suspended" ? "active" : "suspended";
    const message = nextStatus === "suspended"
      ? `Suspend ${member.full_name}? Their staff access will stop immediately.`
      : `Reactivate ${member.full_name}'s assigned staff roles?`;
    if (!window.confirm(message)) return;
    setBusy(`status-${member.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: member.id, status: nextStatus }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update staff access.");
      await load();
      onNotice(`${member.full_name} is now ${nextStatus}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update staff access.");
    } finally {
      setBusy("");
    }
  };

  return <section className="admin-overview admin-staff-management">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">ACCESS & ACCOUNTABILITY</div><h1>Staff Management</h1>
        <p>Create roles from specific work permissions, then assign one or more roles to each staff member. Refunds, account-security settings, and staff management stay owner-only.</p></div>
    </div>
    <form className="admin-staff-invite" onSubmit={(event) => void createRole(event)}>
        <h2>Create a staff role</h2>
        <label className="field-label">Role name<input className="text-input" name="roleName" maxLength={80} required /></label>
        <fieldset className="admin-staff-permissions">
          <legend>Permissions included in this role</legend>
          {STAFF_PERMISSION_OPTIONS.map((permission) => <label key={permission.id}>
            <input type="checkbox" name="permissions" value={permission.id} />
            <span>{permission.label}</span>
          </label>)}
        </fieldset>
        <button className="button button-dark" type="submit" disabled={busy !== ""}>{busy === "role" ? "Creating role…" : "Create role"}</button>
    </form>
    <form className="admin-staff-invite" onSubmit={(event) => void invite(event)}>
        <h2>Invite staff</h2>
        <label className="field-label">Full name<input className="text-input" name="fullName" autoComplete="name" maxLength={120} required /></label>
        <label className="field-label">Work email<input className="text-input" name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <fieldset className="admin-staff-permissions">
          <legend>Assign one or more roles</legend>
          {roles.map((role) => <label key={role.id}>
            <input type="checkbox" name="roleIds" value={role.id} />
            <span>{role.name}</span>
          </label>)}
          {!roles.length && <span>Create a role before inviting staff.</span>}
        </fieldset>
        <p className="commerce-note">Supabase sends a one-time invitation link. The staff member sets their own password; no password is created or shared by the administrator.</p>
        <button className="button button-dark" type="submit" disabled={busy !== "" || !roles.length}>{busy === "invite" ? "Sending invitation…" : "Invite staff"}</button>
    </form>
    <section className="admin-staff-list">
      <h2>Staff accounts · {staff.length}</h2>
      {loading ? <p className="commerce-note">Loading staff accounts…</p> : staff.length ? <div className="commerce-list">
        {staff.map((member) => <article className="admin-staff-row" key={member.id}>
          <div><strong>{member.full_name}</strong><span>{member.employee_code} · Login: {member.email}</span><small>{member.roles.map((role) => role.name).join(" · ") || "No roles assigned"} · {member.status === "invited" ? "Invitation sent" : member.status}</small>
            {editingRolesFor === member.id && <fieldset className="admin-staff-permissions">
              <legend>Assigned roles</legend>
              {roles.map((role) => <label key={role.id}>
                <input type="checkbox" checked={(roleSelections[member.id] ?? []).includes(role.id)} onChange={(event) => {
                  setRoleSelections((current) => ({
                    ...current,
                    [member.id]: event.target.checked
                      ? [...(current[member.id] ?? []), role.id]
                      : (current[member.id] ?? []).filter((id) => id !== role.id),
                  }));
                }} />
                <span>{role.name}</span>
              </label>)}
              <button className="button button-dark" type="button" disabled={busy !== ""} onClick={() => void saveRoles(member)}>{busy === `roles-${member.id}` ? "Saving…" : "Save roles"}</button>
            </fieldset>}
          </div>
          <div className="admin-staff-row-actions">
            <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => {
              setEditingRolesFor(editingRolesFor === member.id ? null : member.id);
              setRoleSelections((current) => ({ ...current, [member.id]: member.roles.map((role) => role.id) }));
            }}>{editingRolesFor === member.id ? "Cancel" : "Manage roles"}</button>
            <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => void changeStatus(member)}>
              {busy === `status-${member.id}` ? "Updating…" : member.status === "suspended" ? "Reactivate" : "Suspend access"}
            </button>
          </div>
        </article>)}
      </div> : <p className="commerce-note">No staff accounts yet.</p>}
    </section>
    <section className="admin-staff-list">
      <h2>Recent staff activity</h2>
      {audit.length ? <ol className="admin-staff-audit">{audit.map((entry) => <li key={entry.id}>
        <strong>{entry.actor_username}</strong> {entry.action.replaceAll("_", " ")}{entry.entity_id ? ` · staff record ${entry.entity_id}` : ""}
        <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam" })} Tanzania time</time>
      </li>)}</ol> : <p className="commerce-note">No staff activity has been recorded.</p>}
    </section>
  </section>;
}
