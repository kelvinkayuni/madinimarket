"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StaffConversation = {
  id: string;
  staff_member_id: number;
  full_name: string;
  employee_code: string;
  updated_at: string;
  last_message_at: string;
  unread_by_admin: boolean;
  unread_by_staff: boolean;
};
type StaffChatMessage = { id: string; sender_type: "staff" | "admin"; message: string; created_at: string };

export default function StaffAdminChat({ admin, onNotice }: { admin: boolean; onNotice: (message: string) => void }) {
  const [conversations, setConversations] = useState<StaffConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);

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
        setConversations(nextConversations);
        setSelectedId((current) => current && nextConversations.some((item) => item.id === current)
          ? current
          : nextConversations[0]?.id ?? null);
      } else {
        setConversations(result.conversation ? [result.conversation] : []);
        setSelectedId(result.conversation?.id ?? null);
        setMessages(result.messages ?? []);
        setConversationLoading(false);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load staff chat.");
    } finally {
      setLoading(false);
    }
  }, [admin, getHeaders, onNotice]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const url = admin
        ? `/api/admin/staff-chat?conversationId=${encodeURIComponent(conversationId)}`
        : "/api/staff/admin-chat";
      const response = await fetch(url, { headers: await getHeaders(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load this chat.");
      setMessages(result.messages ?? []);
      if (result.conversation) {
        setConversations((current) => current.map((item) => item.id === result.conversation.id
          ? { ...item, ...result.conversation }
          : item));
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not load this chat.");
    } finally {
      setConversationLoading(false);
    }
  }, [admin, getHeaders, onNotice]);

  useEffect(() => {
    setLoading(true);
    void loadConversations();
    const interval = window.setInterval(() => void loadConversations(), 20_000);
    return () => window.clearInterval(interval);
  }, [admin, loadConversations]);

  useEffect(() => {
    if (!admin || !selectedId) {
      if (admin && !selectedId) setMessages([]);
      return;
    }
    setConversationLoading(true);
    void loadMessages(selectedId);
    const interval = window.setInterval(() => void loadMessages(selectedId), 10_000);
    return () => window.clearInterval(interval);
  }, [admin, loadMessages, selectedId]);

  useEffect(() => {
    const element = messageListRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = reply.trim();
    if (!message || sending || (admin && !selectedId)) return;
    setSending(true);
    try {
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        method: "POST",
        headers: await getHeaders(true),
        body: JSON.stringify({ conversationId: selectedId, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not send your message.");
      setReply("");
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

  const selectedConversation = conversations.find((item) => item.id === selectedId) ?? null;
  return <div className={`support-inbox staff-admin-chat${admin ? "" : " is-staff-chat"}${admin ? mobileConversationOpen ? " is-conversation-open" : "" : " is-conversation-open"}`}>
    {admin ? <aside className="support-thread-list">
      <div className="support-list-heading"><strong>Staff conversations</strong></div>
      <div className="support-thread-scroll">
        {loading ? <p className="admin-empty">Loading staff conversations…</p> : conversations.length ? conversations.map((item) =>
          <button type="button" key={item.id} className={`support-thread${selectedId === item.id ? " is-selected" : ""}`} onClick={() => { setSelectedId(item.id); setMobileConversationOpen(true); }}>
            <span><strong>{item.employee_code}</strong><small>{item.full_name}</small></span>
            <b>{item.unread_by_admin ? "New message" : "Direct chat"}</b>
            <em>{new Date(item.last_message_at).toLocaleString()}</em>
            {item.unread_by_admin && <i>Unread</i>}
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
        </div>
        <div className="support-message-list" ref={messageListRef} role="log" aria-live="polite">
          {conversationLoading && !messages.length
            ? <p className="admin-empty">Loading messages…</p>
            : messages.length ? messages.map((item) =>
              <article className={`support-message ${item.sender_type === "admin" ? "admin" : ""}`} key={item.id}>
                <span>{item.sender_type === "admin" ? "Admin" : admin ? selectedConversation?.full_name ?? "Staff" : "You"}</span>
                <p>{item.message}</p>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </article>,
            ) : <p className="support-empty">Send a message to start this conversation.</p>}
        </div>
        <form className="support-reply form-stack" onSubmit={(event) => void sendReply(event)}>
          <label className="field-label">Message<textarea className="text-input" rows={3} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a message to the admin…" required /></label>
          <button className="button button-dark" type="submit" disabled={sending || !reply.trim() || (admin && !selectedId)}>{sending ? "Sending…" : "Send message"}</button>
        </form>
      </> : <p className="support-empty">{loading ? "Loading staff conversations…" : "Select a staff conversation."}</p>}
    </section>
  </div>;
}
