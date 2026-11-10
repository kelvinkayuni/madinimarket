"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StaffConversation = {
  id: string;
  staff_member_id: number;
  full_name: string;
  employee_code: string;
  updated_at: string;
  last_message_at: string;
  unread_count: number;
  unread_by_admin: boolean;
  unread_by_staff: boolean;
};
type ChatAttachment = { id: string; file_name: string; file_type: string; file_size: number; signed_url: string };
type StaffChatMessage = {
  id: string;
  sender_type: "staff" | "admin";
  message: string;
  created_at: string;
  attachments: ChatAttachment[];
  seen_by_admin_at: string | null;
  seen_by_staff_at: string | null;
  reply_to_message_id: string | null;
  reply_to_sender_type: "staff" | "admin" | null;
  reply_to_message: string | null;
};

export default function StaffAdminChat({ admin, onNotice, onUnreadCount }: { admin: boolean; onNotice: (message: string) => void; onUnreadCount: (count: number) => void }) {
  const [conversations, setConversations] = useState<StaffConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<StaffConversation[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<Pick<StaffChatMessage, "id" | "sender_type" | "message"> | null>(null);

  const getHeaders = useCallback(async (json = false) => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    };
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        headers: await getHeaders(),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load staff chat.");
      if (admin) {
        const nextConversations = result.conversations as StaffConversation[];
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        onUnreadCount(nextConversations.reduce((total, item) => total + (item.unread_count ?? 0), 0));
        setSelectedId((current) => current && nextConversations.some((item) => item.id === current)
          ? current
          : nextConversations[0]?.id ?? null);
      } else {
        const nextConversations = result.conversation ? [result.conversation] : [];
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        setSelectedId(result.conversation?.id ?? null);
        setMessages(result.messages ?? []);
        onUnreadCount(result.unreadCount ?? 0);
        setConversationLoading(false);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load staff chat.");
    } finally {
      setLoading(false);
    }
  }, [admin, getHeaders, onNotice, onUnreadCount]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const url = admin
        ? `/api/admin/staff-chat?conversationId=${encodeURIComponent(conversationId)}`
        : "/api/staff/admin-chat";
      const response = await fetch(url, { headers: await getHeaders(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load this chat.");
      setMessages(result.messages ?? []);
      setSelectedMessageIds((current) => new Set([...current].filter((id) => result.messages.some((item: StaffChatMessage) => item.id === id))));
      if (result.conversation) {
        const nextConversations = conversationsRef.current.map((item) => item.id === result.conversation.id
          ? { ...item, ...result.conversation }
          : item);
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        if (admin) onUnreadCount(nextConversations.reduce((total, item) => total + item.unread_count, 0));
      }
      if (!admin) onUnreadCount(result.unreadCount ?? 0);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load this chat.");
    } finally {
      setConversationLoading(false);
    }
  }, [admin, getHeaders, onNotice, onUnreadCount]);

  useEffect(() => {
    setLoading(true);
    void loadConversations();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversations();
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [admin, loadConversations]);

  useEffect(() => {
    if (!admin || !selectedId) {
      if (admin && !selectedId) setMessages([]);
      return;
    }
    setConversationLoading(true);
    if (document.visibilityState === "visible") void loadMessages(selectedId);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages(selectedId);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [admin, loadMessages, selectedId]);

  useEffect(() => {
    const element = messageListRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = reply.trim();
    if ((!message && !files.length) || sending || (admin && !selectedId)) return;
    setSending(true);
    try {
      const form = new FormData();
      form.set("message", message);
      if (replyTo) form.set("replyToMessageId", replyTo.id);
      if (admin && selectedId) form.set("conversationId", selectedId);
      for (const file of files) form.append("attachments", file);
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        method: "POST",
        headers: await getHeaders(),
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not send your message.");
      setReply("");
      setReplyTo(null);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadConversations();
      if (result.conversation?.id) {
        setSelectedId(result.conversation.id);
        await loadMessages(result.conversation.id);
      } else if (selectedId) {
        await loadMessages(selectedId);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not send your message.");
    } finally {
      setSending(false);
    }
  };

  const clearConversation = async () => {
    if (!selectedId || !window.confirm("Permanently delete this conversation, including all messages and attachments, for both you and the other person? This cannot be undone.")) return;
    try {
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        method: "DELETE",
        headers: await getHeaders(true),
        body: JSON.stringify({ conversationId: selectedId, clearConversation: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not permanently delete this conversation.");
      setMessages([]);
      setSelectedMessageIds(new Set());
      setReplyTo(null);
      setSelectedId(null);
      setMobileConversationOpen(false);
      await loadConversations();
      onNotice("Conversation permanently deleted for both sides.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not permanently delete this conversation.");
    }
  };

  const deleteMessages = async (messageIds: string[]) => {
    if (!selectedId || !messageIds.length || !window.confirm(`Delete ${messageIds.length === 1 ? "this message" : `${messageIds.length} selected messages`} for both people? This cannot be undone.`)) return;
    try {
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        method: "DELETE",
        headers: await getHeaders(true),
        body: JSON.stringify({ conversationId: selectedId, messageIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not delete the selected messages.");
      setSelectedMessageIds(new Set());
      await loadMessages(selectedId);
      await loadConversations();
      onNotice("Selected messages deleted.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete the selected messages.");
    }
  };
  const deleteSelectedMessages = async () => deleteMessages([...selectedMessageIds]);

  const selectedConversation = conversations.find((item) => item.id === selectedId) ?? null;
  return <div className={`support-inbox staff-admin-chat${admin ? "" : " is-staff-chat"}${admin ? mobileConversationOpen ? " is-conversation-open" : "" : " is-conversation-open"}`}>
    {admin ? <aside className="support-thread-list">
      <div className="support-list-heading"><strong>Staff conversations</strong></div>
      <div className="support-thread-scroll">
        {loading ? <p className="admin-empty">Loading staff conversations…</p> : conversations.length ? conversations.map((item) =>
          <button type="button" key={item.id} className={`support-thread${selectedId === item.id ? " is-selected" : ""}`} onClick={() => { setSelectedId(item.id); setReplyTo(null); setMobileConversationOpen(true); }}>
            <span><strong>{item.employee_code}</strong><small>{item.full_name}</small></span>
            <b>{item.unread_by_admin ? "New message" : "Direct chat"}</b>
            <em>{new Date(item.last_message_at).toLocaleString()}</em>
            {item.unread_count > 0 && <i>{item.unread_count} unread</i>}
          </button>,
        ) : <p className="admin-empty">Staff conversations will appear here when a staff member sends a message.</p>}
      </div>
    </aside> : <aside className="support-thread-list staff-chat-intro">
      <div className="support-list-heading"><strong>Direct chat with admin</strong></div>
      <p>Use this private conversation to message the administrator about your staff work.</p>
    </aside>}
    <section className="support-conversation">
      {selectedConversation || !admin ? <>
        <div className="support-detail-heading">
          <div>
            {admin && <button className="support-mobile-back" type="button" onClick={() => setMobileConversationOpen(false)}>← Back to conversations</button>}
            <span>{admin && selectedConversation ? `${selectedConversation.employee_code} · ${selectedConversation.full_name}` : "PRIVATE STAFF CHAT"}</span>
            <h2>{admin ? selectedConversation?.full_name ?? "Select a staff conversation" : "Chat with admin"}</h2>
          </div>
          <div className="staff-chat-conversation-actions">
            <button className="button button-outline staff-chat-delete-conversation" type="button" onClick={() => void clearConversation()} disabled={!selectedId}>Delete conversation for everyone</button>
            <button className="button button-outline" type="button" onClick={() => void deleteSelectedMessages()} disabled={!selectedMessageIds.size}>Delete selected</button>
          </div>
        </div>
        <div className="support-message-list" ref={messageListRef} role="log" aria-live="polite">
          {conversationLoading && !messages.length
            ? <p className="admin-empty">Loading messages…</p>
            : messages.length ? messages.map((item) =>
              <article className={`support-message ${item.sender_type === "admin" ? "admin" : ""}`} key={item.id}>
                {item.sender_type === (admin ? "admin" : "staff") && <label className="staff-chat-message-select"><input type="checkbox" checked={selectedMessageIds.has(item.id)} onChange={(event) => setSelectedMessageIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })} /> Select your message</label>}
                <span>{item.sender_type === "admin" ? "Admin" : admin ? selectedConversation?.full_name ?? "Staff" : "You"}</span>
                {item.reply_to_message && <blockquote className="staff-chat-reply-quote"><strong>{item.reply_to_sender_type === "admin" ? "Admin" : admin ? selectedConversation?.full_name ?? "Staff" : "You"}</strong><span>{item.reply_to_message}</span></blockquote>}
                <p>{item.message}</p>
                {item.attachments.map((attachment) => attachment.file_type.startsWith("image/")
                  ? <a className="staff-chat-attachment staff-chat-image-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" key={attachment.id}><Image src={attachment.signed_url} width={240} height={180} unoptimized alt={attachment.file_name} /><span>{attachment.file_name}</span></a>
                  : <a className="staff-chat-attachment" href={attachment.signed_url} target="_blank" rel="noreferrer" key={attachment.id}>{attachment.file_name} <small>({Math.ceil(attachment.file_size / 1024)} KB)</small></a>)}
                <small className="staff-chat-message-footer">{new Date(item.created_at).toLocaleString()}
                  {item.sender_type === (admin ? "admin" : "staff") && <span className={`staff-chat-receipt${(admin ? item.seen_by_staff_at : item.seen_by_admin_at) ? " is-seen" : ""}`} aria-label={(admin ? item.seen_by_staff_at : item.seen_by_admin_at) ? "Seen" : "Sent"}>{(admin ? item.seen_by_staff_at : item.seen_by_admin_at) ? "✓✓" : "✓"}</span>}
                </small>
                <div className="staff-chat-message-actions">
                  <button type="button" onClick={() => setReplyTo({ id: item.id, sender_type: item.sender_type, message: item.message })}>Reply</button>
                  {item.sender_type === (admin ? "admin" : "staff") && <button type="button" onClick={() => void deleteMessages([item.id])}>Delete</button>}
                </div>
              </article>,
            ) : <p className="support-empty">Send a message to start this conversation.</p>}
        </div>
        <form className="support-reply form-stack" onSubmit={(event) => void sendReply(event)}>
          {replyTo && <div className="staff-chat-reply-preview"><div><strong>Replying to {replyTo.sender_type === "admin" ? "Admin" : admin ? selectedConversation?.full_name ?? "Staff" : "You"}</strong><span>{replyTo.message}</span></div><button className="button button-outline" type="button" onClick={() => setReplyTo(null)}>Cancel reply</button></div>}
          <label className="field-label">Message<textarea className="text-input" rows={3} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a message to the admin…" /></label>
          <label className="field-label">Attach images or files<input ref={fileInputRef} className="text-input" type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,.docx,.xlsx" onChange={(event) => {
            const selectedFiles = Array.from(event.target.files ?? []);
            if (selectedFiles.length > 5) {
              onNotice("Attach no more than 5 files to a message.");
              event.target.value = "";
              setFiles([]);
              return;
            }
            setFiles(selectedFiles);
          }} /></label>
          <small>Up to 5 files per message; images, PDF, TXT, DOCX, or XLSX, 10 MB per file.</small>
          <button className="button button-dark" type="submit" disabled={sending || (!reply.trim() && !files.length) || (admin && !selectedId)}>{sending ? "Sending…" : "Send message"}</button>
        </form>
      </> : <p className="support-empty">{loading ? "Loading staff conversations…" : "Select a staff conversation."}</p>}
    </section>
  </div>;
}
