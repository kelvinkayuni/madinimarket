"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { STAFF_PERMISSION_OPTIONS, type StaffPermission } from "@/lib/staff-permissions";

type StaffRole = {
  id: number;
  name: string;
  permissions: StaffPermission[];
  assignedStaffCount: number;
};

type StaffMember = {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  username: string;
  sex: "male" | "female" | "prefer_not_to_say" | null;
  residence: string | null;
  roles: StaffRole[];
  status: "invited" | "active" | "suspended";
  setupComplete: boolean;
  created_at: string;
  taskCompletionCounts: {
    today: number;
    month: number;
    year: number;
    byTaskType: Record<string, { today: number; month: number; year: number }>;
  };
};

const staffTaskLabels: Record<string, string> = {
  listing_review: "Seller submission reviews",
  buyer_request_review: "Buyer submission reviews",
  certificate_review: "Licence reviews",
  marketplace_order: "Marketplace order processing",
  marketplace_delivery: "Delivery confirmations",
  marketplace_payout: "Seller payouts",
  marketplace_dispute: "Order disputes",
  buyer_refund: "Buyer refunds",
  support_thread: "Support conversations",
  website_account: "Seller/Buyer accounts",
  translation_pair: "Translations",
  homepage_setting: "Homepage display",
  account_setting: "Account settings",
  subscription_payment: "Subscription payment confirmations",
};
export default function AdminStaffManagement({ onNotice }: { onNotice: (message: string) => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [editingRolesFor, setEditingRolesFor] = useState<number | null>(null);
  const [roleSelections, setRoleSelections] = useState<Record<number, number[]>>({});
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editedRoleName, setEditedRoleName] = useState("");
  const [editedRolePermissions, setEditedRolePermissions] = useState<StaffPermission[]>([]);
  const roleListRef = useRef<HTMLDivElement>(null);
  const roleListScrollTop = useRef(0);
  const staffListRef = useRef<HTMLDivElement>(null);
  const staffListScrollTop = useRef(0);

  useLayoutEffect(() => {
    if (roleListRef.current) roleListRef.current.scrollTop = roleListScrollTop.current;
  }, [roles]);

  useLayoutEffect(() => {
    if (staffListRef.current) staffListRef.current.scrollTop = staffListScrollTop.current;
  }, [staff]);

  const rolesWithPermission = (permission: StaffPermission) => roles
    .filter((role) => role.permissions.includes(permission))
    .map((role) => role.name);

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
  }, []);

  useEffect(() => {
    let active = true;
    const refreshVisibleStaff = () => {
      if (document.visibilityState !== "visible") return;
      void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not refresh staff accounts.");
      });
    };
    const initialLoad = window.setTimeout(() => {
      void load().catch((error: unknown) => {
        if (active) onNotice(error instanceof Error ? error.message : "Could not load staff.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 0);
    const refreshInterval = window.setInterval(refreshVisibleStaff, 30_000);
    window.addEventListener("focus", refreshVisibleStaff);
    document.addEventListener("visibilitychange", refreshVisibleStaff);
    return () => {
      active = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshVisibleStaff);
      document.removeEventListener("visibilitychange", refreshVisibleStaff);
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
          sex: values.get("sex"),
          residence: values.get("residence"),
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

  const resendInvitation = async (member: StaffMember) => {
    setBusy(`resend-${member.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend_invitation", staffId: member.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not resend the setup link.");
      await load();
      onNotice(`A fresh setup link was sent to ${result.email}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not resend the setup link.");
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

  const saveRole = async (role: StaffRole) => {
    setBusy(`role-save-${role.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_role",
          roleId: role.id,
          name: editedRoleName,
          permissions: editedRolePermissions,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update the role.");
      setEditingRoleId(null);
      await load();
      onNotice(`Staff role “${editedRoleName.trim()}” updated.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update the role.");
    } finally {
      setBusy("");
    }
  };

  const deleteRole = async (role: StaffRole) => {
    if (!window.confirm(`Delete the unassigned role “${role.name}”? This cannot be undone.`)) return;
    setBusy(`role-delete-${role.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: role.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete the role.");
      await load();
      onNotice(`Staff role “${role.name}” deleted.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete the role.");
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

  const deleteStaffAccount = async (member: StaffMember) => {
    const warning = [
      `Permanently delete ${member.full_name} (${member.employee_code})?`,
      "",
      "Their sign-in account and role assignments will be removed. Completed work and audit history will be kept under their name and employee code. Unfinished work and work records will not be deleted; another staff member with the relevant role can continue them.",
      "",
      "Make sure another staff member is assigned the roles needed to continue this work.",
    ].join("\n");
    if (!window.confirm(warning)) return;
    setBusy(`delete-${member.id}`);
    try {
      const { data: { session }, error: sessionError } = await getSupabaseBrowserClient().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Administrator session expired.");
      const response = await fetch("/api/admin/staff", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: member.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete the staff account.");
      await load();
      onNotice(result.message ?? `Staff account for ${member.full_name} deleted. Work and history were preserved.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete the staff account.");
    } finally {
      setBusy("");
    }
  };

  return <section className="admin-overview admin-staff-management">
    <div className="admin-page-heading">
      <div><div className="dialog-kicker">ACCESS & ACCOUNTABILITY</div><h1>Staff Management</h1>
        <p>Create roles from specific work permissions, then assign or remove roles for each staff member. Staff may have no roles assigned. Refunds, account-security settings, and staff management stay owner-only.</p></div>
    </div>
    <details className="admin-staff-disclosure">
      <summary><span><strong>Create a staff role</strong><small>Define permissions for staff work</small></span><span className="admin-staff-disclosure-icon" aria-hidden="true">⌄</span></summary>
      <form className="admin-staff-invite" onSubmit={(event) => void createRole(event)}>
        <label className="field-label">Role name<input className="text-input" name="roleName" maxLength={80} required /></label>
        <fieldset className="admin-staff-permissions">
          <legend>Permissions included in this role</legend>
          {STAFF_PERMISSION_OPTIONS.map((permission) => {
            const includedIn = rolesWithPermission(permission.id);
            return <label key={permission.id}>
              <input type="checkbox" name="permissions" value={permission.id} />
              <span>
                <span>{permission.label}</span>
                <small className="admin-staff-permission-status">
                  {includedIn.length ? `Included in: ${includedIn.join(", ")}` : "Not included in any job role"}
                </small>
              </span>
            </label>;
          })}
        </fieldset>
        <button className="button button-dark" type="submit" disabled={busy !== ""}>{busy === "role" ? "Creating role…" : "Create role"}</button>
      </form>
    </details>
    <section className="admin-staff-list" aria-labelledby="admin-staff-roles-heading">
      <h2 id="admin-staff-roles-heading">Staff roles ({roles.length})</h2>
      {roles.length ? <div
        className="commerce-list admin-staff-role-list"
        ref={roleListRef}
        onScroll={(event) => { roleListScrollTop.current = event.currentTarget.scrollTop; }}
      >
        {roles.map((role) => {
          const assigned = role.assignedStaffCount > 0;
          const editing = editingRoleId === role.id;
          return <article className="admin-staff-role-row" key={role.id}>
            <div className="admin-staff-role-content">
              {editing ? <>
                <label className="field-label">Role name<input className="text-input" value={editedRoleName} maxLength={80} onChange={(event) => setEditedRoleName(event.target.value)} /></label>
                <fieldset className="admin-staff-permissions">
                  <legend>Role permissions</legend>
                  {STAFF_PERMISSION_OPTIONS.map((permission) => {
                    const includedIn = rolesWithPermission(permission.id);
                    return <label key={permission.id}>
                      <input type="checkbox" checked={editedRolePermissions.includes(permission.id)} onChange={(event) => {
                        setEditedRolePermissions((current) => event.target.checked
                          ? [...current, permission.id]
                          : current.filter((value) => value !== permission.id));
                      }} />
                      <span>
                        <span>{permission.label}</span>
                        <small className="admin-staff-permission-status">
                          {includedIn.length ? `Included in: ${includedIn.join(", ")}` : "Not included in any job role"}
                        </small>
                      </span>
                    </label>;
                  })}
                </fieldset>
              </> : <>
                <strong>{role.name}</strong>
                <small>{assigned ? `Assigned to staff (${role.assignedStaffCount}) · Editing and deletion are locked` : "Not assigned · can be edited or deleted"}</small>
                <details className="admin-staff-role-permission-details">
                  <summary>View job role ({role.permissions.length})</summary>
                  <ul>{role.permissions.map((permission) => (
                    <li key={permission}>{STAFF_PERMISSION_OPTIONS.find((option) => option.id === permission)?.label ?? permission}</li>
                  ))}</ul>
                </details>
              </>}
            </div>
            <div className="admin-staff-row-actions">
              {editing ? <>
                <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => setEditingRoleId(null)}>Cancel</button>
                <button className="button button-dark" type="button" disabled={busy !== "" || editedRoleName.trim().length < 2 || editedRolePermissions.length === 0} onClick={() => void saveRole(role)}>
                  {busy === `role-save-${role.id}` ? "Saving…" : "Save role"}
                </button>
              </> : <>
                <button className="button button-outline" type="button" disabled={busy !== "" || assigned} title={assigned ? "Remove this role from all staff before editing it." : "Edit this role"} onClick={() => {
                  setEditedRoleName(role.name);
                  setEditedRolePermissions(role.permissions);
                  setEditingRoleId(role.id);
                }}>Edit role</button>
                <button className="button button-danger" type="button" disabled={busy !== "" || assigned} title={assigned ? "Remove this role from all staff before deleting it." : "Delete this unassigned role"} onClick={() => void deleteRole(role)}>
                  {busy === `role-delete-${role.id}` ? "Deleting…" : "Delete role"}
                </button>
              </>}
            </div>
          </article>;
        })}
      </div> : <p className="commerce-note">No staff roles have been created.</p>}
    </section>
    <details className="admin-staff-disclosure">
      <summary><span><strong>Invite staff</strong><small>Add a staff member and assign their work roles</small></span><span className="admin-staff-disclosure-icon" aria-hidden="true">⌄</span></summary>
      <form className="admin-staff-invite" onSubmit={(event) => void invite(event)}>
        <label className="field-label">Full name<input className="text-input" name="fullName" autoComplete="name" maxLength={120} required /></label>
        <label className="field-label">Sex (optional)
          <select className="text-input" name="sex" defaultValue="">
            <option value="">Select sex</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </label>
        <label className="field-label">Permanent residence / work area (optional)
          <input className="text-input" name="residence" autoComplete="street-address" maxLength={200} placeholder="City, district, or region" />
        </label>
        <label className="field-label">Work email<input className="text-input" name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <fieldset className="admin-staff-permissions">
          <legend>Assign one or more roles</legend>
          {roles.map((role) => <div className="admin-staff-role-option" key={role.id}>
            <label>
              <input type="checkbox" name="roleIds" value={role.id} />
              <span>{role.name}</span>
            </label>
            <details className="admin-staff-role-permission-details">
              <summary>View job role ({role.permissions.length})</summary>
              <ul>{role.permissions.map((permission) => (
                <li key={permission}>{STAFF_PERMISSION_OPTIONS.find((option) => option.id === permission)?.label ?? permission}</li>
              ))}</ul>
            </details>
          </div>)}
          {!roles.length && <span>Create a role before inviting staff.</span>}
        </fieldset>
        <p className="commerce-note">Supabase sends a one-time invitation link. The staff member sets their own password; no password is created or shared by the administrator.</p>
        <button className="button button-dark" type="submit" disabled={busy !== "" || !roles.length}>{busy === "invite" ? "Sending invitation…" : "Invite staff"}</button>
      </form>
    </details>
    <section className="admin-staff-list">
      <h2>Staff accounts ({staff.length})</h2>
      {loading ? <p className="commerce-note">Loading staff accounts…</p> : staff.length ? <div
        className="commerce-list admin-staff-account-list"
        ref={staffListRef}
        onScroll={(event) => { staffListScrollTop.current = event.currentTarget.scrollTop; }}
      >
        {staff.map((member) => <article className="admin-staff-row" key={member.id}>
          <div><strong>{member.full_name}</strong><span>{member.employee_code} · Login: {member.email}</span><small><strong className="admin-staff-assigned-roles">{member.roles.map((role) => role.name).join(" · ") || "No roles assigned"}</strong> · {member.status === "invited" ? "Invitation sent" : member.status}{!member.setupComplete ? " · Setup not completed" : ""}</small>
            {(member.sex || member.residence) && <small>{member.sex ? `Sex: ${member.sex.replaceAll("_", " ")}` : ""}{member.sex && member.residence ? " · " : ""}{member.residence ? `Residence / work area: ${member.residence}` : ""}</small>}
            <details className="admin-staff-completion-details">
              <summary>Completed tasks · Today {member.taskCompletionCounts.today} · This month {member.taskCompletionCounts.month} · This year {member.taskCompletionCounts.year}</summary>
              <p>Counts begin when completion tracking is enabled. Periods use Tanzania time.</p>
              {Object.keys(member.taskCompletionCounts.byTaskType).length ? <div className="admin-staff-completion-table" role="table" aria-label={`Completed tasks by type for ${member.full_name}`}>
                <div role="row"><strong role="columnheader">Task type</strong><strong role="columnheader">Today</strong><strong role="columnheader">This month</strong><strong role="columnheader">This year</strong></div>
                {Object.entries(member.taskCompletionCounts.byTaskType)
                  .sort(([a], [b]) => (staffTaskLabels[a] ?? a).localeCompare(staffTaskLabels[b] ?? b))
                  .map(([taskType, counts]) => <div role="row" key={taskType}>
                    <span role="cell">{staffTaskLabels[taskType] ?? taskType}</span>
                    <span role="cell">{counts.today}</span>
                    <span role="cell">{counts.month}</span>
                    <span role="cell">{counts.year}</span>
                  </div>)}
              </div> : <small>No staff tasks completed this year.</small>}
            </details>
            {editingRolesFor === member.id && <fieldset className="admin-staff-permissions">
              <legend>Assigned roles (optional)</legend>
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
            {member.status === "invited" && !member.setupComplete && <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => void resendInvitation(member)}>
              {busy === `resend-${member.id}` ? "Sending link…" : "Resend setup link"}
            </button>}
            <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => {
              setEditingRolesFor(editingRolesFor === member.id ? null : member.id);
              setRoleSelections((current) => ({ ...current, [member.id]: member.roles.map((role) => role.id) }));
            }}>{editingRolesFor === member.id ? "Cancel" : "Manage roles"}</button>
            <button className="button button-outline" type="button" disabled={busy !== ""} onClick={() => void changeStatus(member)}>
              {busy === `status-${member.id}` ? "Updating…" : member.status === "suspended" ? "Reactivate" : "Suspend access"}
            </button>
            <button
              className="button button-danger"
              type="button"
              disabled={busy !== ""}
              title="Delete this staff account while preserving completed history and unfinished work."
              onClick={() => void deleteStaffAccount(member)}
            >
              {busy === `delete-${member.id}` ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </article>)}
      </div> : <p className="commerce-note">No staff accounts yet.</p>}
    </section>
  </section>;
}
