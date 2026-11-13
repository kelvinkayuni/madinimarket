"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LoaderCircle, Paperclip, Send } from "lucide-react";
import { fetchWithWebsiteSession } from "@/lib/client-website-session";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import StaffTaskClaim from "./staff-task-claim";

export type SupportThread = {
  id: string; ticket_number: string; category: string; subject: string; status: string;
  unread_by_admin?: boolean; unread_by_user?: boolean; unread_count?: number; internal_note?: string;
  created_at: string; updated_at: string; last_message_at: string;
  website_accounts?: { id: string; display_name: string; username: string; email: string; phone: string | null } | null;
};
export type SupportMessage = {
  id: string;
  sender_type: "user" | "admin";
  message: string;
  created_at: string;
  seen_by_admin_at: string | null;
  seen_by_user_at: string | null;
  support_attachments: { id: string; file_name: string; file_type: string; file_size: number; signed_url: string | null }[];
};

const statusLabels: Record<string, string> = { open: "Open", admin_replied: "Admin replied", pending_user: "Waiting for user", resolved: "Resolved" };
const supportAttachmentTypes = "application/pdf,image/jpeg,image/png";
const supportAttachmentSize = 4 * 1024 * 1024;
const supportAttachmentUrlRefreshMs = 10 * 60 * 1000;

function supportMessagesMatch(current: SupportMessage[], next: SupportMessage[]) {
  if (current.length !== next.length) return false;
  const previousById = new Map(current.map((message) => [message.id, message]));
  return next.every((message) => {
    const previous = previousById.get(message.id);
    return previous
      && previous.sender_type === message.sender_type
      && previous.message === message.message
      && previous.created_at === message.created_at
      && previous.seen_by_admin_at === message.seen_by_admin_at
      && previous.seen_by_user_at === message.seen_by_user_at
      && previous.support_attachments.length === message.support_attachments.length
      && message.support_attachments.every((attachment) => {
        const previousAttachment = previous.support_attachments.find((item) => item.id === attachment.id);
        return previousAttachment
          && previousAttachment.file_name === attachment.file_name
          && previousAttachment.file_type === attachment.file_type
          && previousAttachment.file_size === attachment.file_size;
      });
  });
}

export default function SupportInbox({ admin = false, staffClaims = false, onNotice, onUnreadCount }: { admin?: boolean; staffClaims?: boolean; onNotice: (message: string) => void; onUnreadCount?: (count: number) => void }) {
  const [adminAccessToken, setAdminAccessToken] = useState("");
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [internalNote, setInternalNote] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentUrlRefreshAt = useRef(new Map<string, number>());

  const getFreshAdminHeaders = useCallback(async (includeJson = false) => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return {
      ...(includeJson ? { "Content-Type": "application/json" } : {}),
      ...(data.session?.access_token ? { Authorization: "Bearer " + data.session.access_token } : {}),
    };
  }, []);
  const userFetch = useCallback((url: string, init?: RequestInit) => admin
    ? fetch(url, {
      ...init,
      headers: { ...(adminAccessToken ? { Authorization: "Bearer " + adminAccessToken } : {}), ...(init?.headers ?? {}) },
      cache: "no-store",
    })
    : fetchWithWebsiteSession(url, init), [admin, adminAccessToken]);
  const loadThreads = useCallback(async () => {
    try {
      const response = await userFetch(admin ? `/api/admin/support` : `/api/support`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load support messages.");
      const nextThreads = (result.threads ?? []) as SupportThread[];
      setThreads(nextThreads);
      onUnreadCount?.(result.unread_count ?? nextThreads.reduce((total, item) => total + (item.unread_count ?? 0), 0));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load support messages."); }
    finally { setLoading(false); }
  }, [admin, onNotice, onUnreadCount, userFetch]);
  const loadDetail = useCallback(async (id: string, refreshList = true) => {
    try {
      const response = await userFetch(admin ? `/api/admin/support?threadId=${encodeURIComponent(id)}` : `/api/support/${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load this conversation.");
      const nextThread = result.thread as SupportThread;
      const nextMessages = (result.messages ?? []) as SupportMessage[];
      setThread((current) => current
        && current.id === nextThread.id
        && current.status === nextThread.status
        && current.subject === nextThread.subject
        && current.updated_at === nextThread.updated_at
        && current.last_message_at === nextThread.last_message_at
        && current.internal_note === nextThread.internal_note
        ? current
        : nextThread);
      if (refreshList) setInternalNote(nextThread.internal_note ?? "");
      const now = Date.now();
      const hasAttachments = nextMessages.some((message) => message.support_attachments.length > 0);
      const refreshAttachmentUrls = hasAttachments &&
        now - (attachmentUrlRefreshAt.current.get(id) ?? 0) >= supportAttachmentUrlRefreshMs;
      setMessages((current) => {
        if (!refreshAttachmentUrls && supportMessagesMatch(current, nextMessages)) return current;
        const previousById = new Map(current.map((message) => [message.id, message]));
        return nextMessages.map((message) => {
          const previous = previousById.get(message.id);
          return {
            ...message,
            support_attachments: message.support_attachments.map((attachment) => {
              const previousAttachment = previous?.support_attachments.find((item) => item.id === attachment.id);
              return previousAttachment?.signed_url && !refreshAttachmentUrls
                ? { ...attachment, signed_url: previousAttachment.signed_url }
                : attachment;
            }),
          };
        });
      });
      if (refreshAttachmentUrls) attachmentUrlRefreshAt.current.set(id, now);
      setSelectedMessageIds((current) => new Set([...current].filter((messageId) => nextMessages.some((message) => message.id === messageId))));
      setThreads((current) => current.map((item) => item.id === id
        ? { ...item, unread_count: 0, ...(admin ? { unread_by_admin: false } : { unread_by_user: false }) }
        : item));
      if (refreshList) await loadThreads();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not load this conversation."); }
  }, [admin, loadThreads, onNotice, userFetch]);
  useEffect(() => {
    if (!admin) { void loadThreads(); return; }
    void getSupabaseBrowserClient().auth.getSession().then(({ data }) => {
      if (data.session?.access_token) setAdminAccessToken(data.session.access_token);
    });
  }, [admin, loadThreads]);
  useEffect(() => { if (admin && !adminAccessToken) return; void loadThreads(); const interval = window.setInterval(() => void loadThreads(), 30_000); return () => window.clearInterval(interval); }, [admin, adminAccessToken, loadThreads]);
  useEffect(() => {
    if (!selectedId || (admin && !adminAccessToken)) return;
    void loadDetail(selectedId);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDetail(selectedId, false);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [selectedId, admin, adminAccessToken, loadDetail]);


  const submitTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRequest) return;
    if (!window.confirm("Are you sure you want to submit this support request?")) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmittingRequest(true);
    try {
      const response = await fetchWithWebsiteSession("/api/support", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not submit support request.");
      formElement.reset();
      setCreating(false);
      await loadThreads();
      if (result.thread?.id) setSelectedId(result.thread.id);
      onNotice(result.thread?.ticket_number
        ? `Support request ${result.thread.ticket_number} submitted.`
        : "Support request submitted.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not submit support request."); }
    finally { setSubmittingRequest(false); }
  };
  const submitReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedId || (!reply.trim() && !files.length) || submittingReply) return;
    setSubmittingReply(true);
    try {
      const form = new FormData();
      form.set(admin ? "reply" : "message", reply.trim());
      for (const file of files) form.append("attachments", file);
      if (admin) {
        form.set("threadId", selectedId);
        form.set("status", "admin_replied");
        const adminHeaders = await getFreshAdminHeaders();
        const response = await fetch("/api/admin/support", { method: "PATCH", headers: adminHeaders, body: form });
        const result = await response.json();
        if (response.status === 409) {
          await loadDetail(selectedId);
          await loadThreads();
          onNotice(result.error ?? "This support task is no longer available. The inbox has been refreshed.");
          return;
        }
        if (!response.ok) throw new Error(result.error ?? "Could not send reply.");
      } else {
        const response = await fetchWithWebsiteSession(`/api/support/${selectedId}`, { method: "POST", body: form });
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not send reply.");
      }
      setReply(""); setFiles([]); if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDetail(selectedId); await loadThreads(); onNotice("Reply sent.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not send reply."); }
    finally { setSubmittingReply(false); }
  };
  const deleteConversation = async () => {
    if (!selectedId) return;
    const confirmation = admin
      ? "Permanently delete this support request, including all messages and attachments, for everyone? This cannot be undone."
      : "Remove this support request from your inbox? Support staff will still be able to see it.";
    if (!window.confirm(confirmation)) return;
    try {
      const response = admin
        ? await fetch("/api/admin/support", {
          method: "DELETE",
          headers: await getFreshAdminHeaders(true),
          body: JSON.stringify({ threadId: selectedId, clearConversation: true }),
        })
        : await fetchWithWebsiteSession(`/api/support/${selectedId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearConversation: true }),
        });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete the support conversation.");
      setSelectedId(null); setThread(null); setMessages([]); setSelectedMessageIds(new Set()); setMobileConversationOpen(false); await loadThreads();
      onNotice(admin ? "Support conversation permanently deleted." : "Support conversation removed from your inbox.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not delete the support conversation."); }
  };
  const deleteMessages = async (messageIds: string[]) => {
    if (!selectedId || !messageIds.length) return;
    const itemLabel = messageIds.length === 1 ? "this message" : `${messageIds.length} selected messages`;
    const confirmation = admin
      ? `Permanently delete ${itemLabel} for everyone? This cannot be undone.`
      : `Hide ${itemLabel} from your inbox? Support staff will still be able to see them.`;
    if (!window.confirm(confirmation)) return;
    try {
      const response = admin
        ? await fetch("/api/admin/support", {
          method: "DELETE",
          headers: await getFreshAdminHeaders(true),
          body: JSON.stringify({ threadId: selectedId, messageIds }),
        })
        : await fetchWithWebsiteSession(`/api/support/${selectedId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds }),
        });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete the selected messages.");
      setSelectedMessageIds(new Set());
      await loadDetail(selectedId);
      await loadThreads();
      onNotice(admin ? "Selected messages permanently deleted." : "Selected messages hidden from your inbox.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not delete the selected messages."); }
  };
  const deleteSelectedMessages = () => deleteMessages([...selectedMessageIds]);
  const updateStatus = async (status: string) => {
    if (!admin || !selectedId) return;
    const adminHeaders = await getFreshAdminHeaders(true);
    const response = await fetch("/api/admin/support", { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ threadId: selectedId, status }) });
    const result = await response.json();
    if (response.status === 409) { await loadDetail(selectedId); await loadThreads(); onNotice(result.error ?? "This support task is no longer available. The inbox has been refreshed."); return; }
    if (!response.ok) { onNotice(result.error ?? "Could not update status."); return; }
    await loadDetail(selectedId); await loadThreads(); onNotice("Support status updated.");
  };
  const saveNote = async () => {
    if (!admin || !selectedId) return;
    const adminHeaders = await getFreshAdminHeaders(true);
    const response = await fetch("/api/admin/support", { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ threadId: selectedId, internalNote }) });
    const result = await response.json();
    if (response.status === 409) { await loadDetail(selectedId); await loadThreads(); onNotice(result.error ?? "This support task is no longer available. The inbox has been refreshed."); return; }
    if (!response.ok) { onNotice(result.error ?? "Could not save the internal note."); return; }
    onNotice("Internal note saved.");
  };

  useEffect(() => { setCurrentPage(1); }, [statusFilter, searchQuery, dateFilter, dateFrom, dateTo, sortOrder]);

  const visibleThreads = threads
    .filter((item) => statusFilter === "all" || item.status === statusFilter)
    .filter((item) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      const account = item.website_accounts;
      const searchable = admin
        ? [item.ticket_number, item.subject, item.category, account?.display_name, account?.username, account?.email, account?.phone].filter(Boolean).join(" ").toLowerCase()
        : `${item.ticket_number}`.toLowerCase();
      return searchable.includes(query);
    })
    .filter((item) => {
      if (dateFilter === "all") return true;
      const created = new Date(item.created_at);
      const now = new Date();
      if (dateFilter === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return created >= start;
      }
      if (dateFilter === "7days") return created >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (dateFilter === "30days") return created >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (dateFilter === "custom") {
        if (dateFrom && created < new Date(`${dateFrom}T00:00:00`)) return false;
        if (dateTo && created > new Date(`${dateTo}T23:59:59.999`)) return false;
      }
      return true;
    })
    .sort((a, b) => sortOrder === "oldest"
      ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const threadsPerPage = 20;
  const totalPages = Math.max(1, Math.ceil(visibleThreads.length / threadsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedThreads = visibleThreads.slice((safePage - 1) * threadsPerPage, safePage * threadsPerPage);
  return <div className={`support-inbox${mobileConversationOpen ? " is-conversation-open" : ""}`}>
    <aside className="support-thread-list">
      <div className="support-list-heading"><strong>{admin ? "Support inbox" : "Your support"}</strong>{!admin && <button className="button button-dark" type="button" onClick={() => { setCreating(true); setSelectedId(null); setMobileConversationOpen(true); }}>New request</button>}</div>
      <div className="support-filter-toolbar">
        <label className="field-label">Status<select className="text-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="admin_replied">Admin replied</option><option value="pending_user">Waiting for user</option><option value="resolved">Resolved</option></select></label>
        <label className="field-label">{admin ? "Search user or request" : "Search request ID"}<input className="text-input" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={admin ? "Name, user, email, or MM-ID" : "Enter ticket number"} /></label>
        <label className="field-label">Request date<select className="text-input" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">All dates</option><option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option><option value="custom">Custom range</option></select></label>
        {dateFilter === "custom" && <div className="support-date-range"><label className="field-label">From<input className="text-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="field-label">To<input className="text-input" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label></div>}
        <label className="field-label">Sort<select className="text-input" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      <div className="support-thread-scroll">
        {loading ? <p className="admin-empty">Loading…</p> : paginatedThreads.length ? paginatedThreads.map((item) => <button type="button" key={item.id} className={`support-thread${selectedId === item.id ? " is-selected" : ""}`} onClick={() => { setCreating(false); setSelectedId(item.id); setSelectedMessageIds(new Set()); setMobileConversationOpen(true); }}><span><strong>{item.ticket_number}</strong><small>{item.category}</small></span><b>{item.subject}</b><em>{statusLabels[item.status] ?? item.status}</em>{(item.unread_count ?? 0) > 0 && <i>{item.unread_count} unread</i>}</button>) : <p className="admin-empty">No support conversations match these filters.</p>}
      </div>
      {visibleThreads.length > 0 && <div className="support-pagination"><button type="button" className="button button-outline" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>Previous</button><span>Page {safePage} of {totalPages}</span><button type="button" className="button button-outline" onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>Next</button></div>}
    </aside>
    <section className="support-conversation">
      {creating && !admin ? <form className="support-form form-stack" onSubmit={submitTicket}><button className="support-mobile-back" type="button" onClick={() => { setCreating(false); setMobileConversationOpen(false); }}>← Back to requests</button><div className="dialog-kicker">CONTACT ADMIN</div><h2>Create a support request</h2><label className="field-label">Category<select className="text-input" name="category" required><option value="">Choose a category</option>{["Account","Subscription","Payment","Product listing","Order","Other"].map((category) => <option key={category}>{category}</option>)}</select></label><label className="field-label">Subject<input className="text-input" name="subject" minLength={3} maxLength={160} required /></label><label className="field-label">Message<textarea className="text-input" name="message" rows={6} maxLength={5000} required /></label><label className="field-label">Attachments (optional)<input className="text-input" name="attachments" type="file" multiple accept="application/pdf,image/jpeg,image/png" /></label><p className="user-subscription-receipt-help">PDF, JPEG, or PNG. Maximum 4 MB per file.</p><div className="support-actions"><button className="button button-dark" type="submit" disabled={submittingRequest}>{submittingRequest ? "Submitting…" : "Submit request"}</button><button className="button button-outline" type="button" onClick={() => { setCreating(false); setMobileConversationOpen(false); }} disabled={submittingRequest}>Cancel</button></div></form>
      : selectedId && thread ? <StaffTaskClaim type="support_thread" taskId={thread.id} enabled={admin && staffClaims} refreshOnMount={staffClaims} controlInChildren compact onNotice={onNotice}>{({ canAct, control }) => <>
        <div className="support-detail-heading"><div><button className="support-mobile-back" type="button" onClick={() => setMobileConversationOpen(false)}>← Back to requests</button><span>{thread.ticket_number} · {thread.category}</span><div className="support-detail-subject-row"><h2>{thread.subject}</h2>{control}</div>{admin && thread.website_accounts && <small>{thread.website_accounts.display_name} · {thread.website_accounts.username} · {thread.website_accounts.email}</small>}</div><span className={`support-status status-${thread.status}`}>{statusLabels[thread.status] ?? thread.status}</span></div>
          <div className="support-message-list" role="log" aria-live="polite">
            {messages.length ? messages.map((message) => {
              const ownMessage = message.sender_type === (admin ? "admin" : "user");
              const seenAt = admin ? message.seen_by_user_at : message.seen_by_admin_at;
              return <article className={`support-message ${message.sender_type}`} key={message.id}>
                {ownMessage && <label className="staff-chat-message-select"><input type="checkbox" checked={selectedMessageIds.has(message.id)} disabled={!canAct} onChange={(event) => setSelectedMessageIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(message.id);
                  else next.delete(message.id);
                  return next;
                })} /> Select your message</label>}
                <span>{message.sender_type === "admin" ? "Administrator" : admin ? thread.website_accounts?.display_name ?? "User" : "You"}</span>
                <p>{message.message}</p>
                {message.support_attachments?.map((attachment) => attachment.signed_url && (attachment.file_type.startsWith("image/")
                  ? <a className="staff-chat-attachment staff-chat-image-attachment" key={attachment.id} href={attachment.signed_url} target="_blank" rel="noreferrer"><Image src={attachment.signed_url} width={240} height={180} unoptimized alt={attachment.file_name} /><span>{attachment.file_name}</span></a>
                  : <a className="staff-chat-attachment" key={attachment.id} href={attachment.signed_url} target="_blank" rel="noreferrer">{attachment.file_name} <small>({Math.ceil(attachment.file_size / 1024)} KB)</small></a>))}
                <small className="staff-chat-message-footer">{new Date(message.created_at).toLocaleString()}
                  {ownMessage && <span className={`staff-chat-receipt${seenAt ? " is-seen" : ""}`} aria-label={seenAt ? "Seen" : "Sent"}>{seenAt ? "✓✓" : "✓"}</span>}
                </small>
                {ownMessage && <div className="staff-chat-message-actions"><button type="button" disabled={!canAct} onClick={() => void deleteMessages([message.id])}>Delete</button></div>}
              </article>;
            }) : <p className="support-empty">No messages in this conversation yet.</p>}
          </div>
          {admin && <div className="support-admin-tools"><label className="field-label">Status<select className="text-input" value={thread.status} disabled={!canAct} onChange={(event) => void updateStatus(event.target.value)}><option value="open">Open</option><option value="admin_replied">Admin replied</option><option value="pending_user">Waiting for user</option><option value="resolved">Resolved</option></select></label><label className="field-label">Internal admin note<textarea className="text-input" rows={3} maxLength={5000} value={internalNote} disabled={!canAct} onChange={(event) => setInternalNote(event.target.value)} /></label><button className="button button-outline" type="button" disabled={!canAct} onClick={() => void saveNote()}>Save note</button></div>}
          <form className="support-reply" onSubmit={submitReply}>
            {thread.status === "resolved" && <p className="support-resolved-note">This conversation is resolved. You can reopen it by replying.</p>}
            {files.length > 0 && <div className="staff-chat-file-preview" aria-live="polite">{files.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`}>{file.name}</span>)}</div>}
            <div className="staff-chat-composer-row">
              <div className="staff-chat-composer-tools">
                <div className="staff-chat-conversation-actions">
                  <button className="button button-outline staff-chat-delete-conversation" type="button" aria-label={admin ? "Permanently delete support conversation for everyone" : "Remove support conversation from your inbox"} onClick={() => void deleteConversation()} disabled={!canAct}>Delete</button>
                  <button className="button button-outline" type="button" onClick={() => void deleteSelectedMessages()} disabled={!canAct || !selectedMessageIds.size}>Delete selected</button>
                </div>
                <label className="staff-chat-attach-button" title="Attach a PDF, JPEG, or PNG">
                  <Paperclip size={19} aria-hidden="true" />
                  <span className="staff-chat-visually-hidden">Attach a file</span>
                  <input ref={fileInputRef} className="staff-chat-file-input" type="file" multiple accept={supportAttachmentTypes} disabled={!canAct || submittingReply} onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    const invalidFile = selectedFiles.find((file) => !supportAttachmentTypes.split(",").includes(file.type) || file.size < 1 || file.size > supportAttachmentSize);
                    if (invalidFile) {
                      onNotice("Attachments must be PDF, JPEG, or PNG and no larger than 4 MB.");
                      event.target.value = "";
                      setFiles([]);
                      return;
                    }
                    setFiles(selectedFiles);
                  }} />
                </label>
              </div>
              <textarea className="text-input staff-chat-message-input" aria-label="Reply" rows={1} maxLength={5000} value={reply} disabled={!canAct || submittingReply} onChange={(event) => setReply(event.target.value)} placeholder="Message…" />
              <button className="button button-dark staff-chat-send-button" type="submit" aria-label={submittingReply ? "Sending reply" : "Send reply"} aria-busy={submittingReply} disabled={!canAct || submittingReply || (!reply.trim() && !files.length)}>
                {submittingReply
                  ? <LoaderCircle className="support-send-spinner" size={18} aria-hidden="true" />
                  : <Send size={18} aria-hidden="true" />}
              </button>
            </div>
            <small className="staff-chat-attachment-hint">Attach PDF, JPEG, or PNG files up to 4 MB each.</small>
          </form>
        </>}</StaffTaskClaim> : <p className="support-empty">Select a conversation or {admin ? "choose one from the inbox." : "create a new support request."}</p>}
    </section>
  </div>;
}
