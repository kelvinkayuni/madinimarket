"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StaffConversation = {
  id: string | null;
  staff_member_id: number;
  full_name: string;
  employee_code: string;
  updated_at: string | null;
  last_message_at: string | null;
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

const maxTotalAttachmentSize = 4 * 1024 * 1024;

export default function StaffAdminChat({ admin, onNotice, onUnreadCount }: { admin: boolean; onNotice: (message: string) => void; onUnreadCount: (count: number) => void }) {
  const [conversations, setConversations] = useState<StaffConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStaffMemberId, setSelectedStaffMemberId] = useState<number | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [messages, setMessages] = useState<StaffChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldScrollToBottomRef = useRef(true);
  const conversationsRef = useRef<StaffConversation[]>([]);
  const selectedStaffMemberIdRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
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
    const requestId = ++conversationsRequestIdRef.current;
    try {
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        headers: await getHeaders(),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load staff chat.");
      if (requestId !== conversationsRequestIdRef.current) return;
      if (admin) {
        const nextConversations = result.conversations as StaffConversation[];
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        onUnreadCount(nextConversations.reduce((total, item) => total + (item.unread_count ?? 0), 0));
        const selected = nextConversations.find((item) => item.staff_member_id === selectedStaffMemberIdRef.current)
          ?? nextConversations[0]
          ?? null;
        if (selected?.staff_member_id !== selectedStaffMemberIdRef.current) {
          selectedStaffMemberIdRef.current = selected?.staff_member_id ?? null;
          setSelectedStaffMemberId(selectedStaffMemberIdRef.current);
        }
        if (selected?.id !== selectedIdRef.current) {
          selectedIdRef.current = selected?.id ?? null;
          setSelectedId(selectedIdRef.current);
        }
      } else {
        const nextConversations = result.conversation ? [result.conversation] : [];
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        selectedIdRef.current = result.conversation?.id ?? null;
        setSelectedId(result.conversation?.id ?? null);
        setMessages(result.messages ?? []);
        onUnreadCount(result.unreadCount ?? 0);
        setConversationLoading(false);
      }
    } catch (error) {
      if (requestId === conversationsRequestIdRef.current) {
        onNotice(error instanceof Error ? error.message : "Could not load staff chat.");
      }
    } finally {
      if (requestId === conversationsRequestIdRef.current) setLoading(false);
    }
  }, [admin, getHeaders, onNotice, onUnreadCount]);

  const loadMessages = useCallback(async (conversationId: string | null, staffMemberId?: number, signal?: AbortSignal) => {
    const requestId = ++messagesRequestIdRef.current;
    const isCurrentRequest = () => requestId === messagesRequestIdRef.current &&
      !signal?.aborted &&
      (!admin || selectedStaffMemberIdRef.current === staffMemberId);
    try {
      const url = admin
        ? conversationId
          ? `/api/admin/staff-chat?conversationId=${encodeURIComponent(conversationId)}`
          : `/api/admin/staff-chat?staffMemberId=${staffMemberId}`
        : "/api/staff/admin-chat";
      const headers = await getHeaders();
      if (!isCurrentRequest()) return;
      const response = await fetch(url, { headers, cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load this chat.");
      if (!isCurrentRequest()) return;
      const nextMessages = (result.messages ?? []) as StaffChatMessage[];
      const messageList = messageListRef.current;
      shouldScrollToBottomRef.current = !messageList ||
        messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
      setMessages(nextMessages);
      setSelectedMessageIds((current) => new Set([...current].filter((id) => nextMessages.some((item) => item.id === id))));

      if (admin && result.conversation && result.conversation.id !== conversationId) {
        selectedIdRef.current = result.conversation.id;
        setSelectedId(result.conversation.id);
      }

      let updatedConversation = result.conversation as StaffConversation | undefined;
      const readThroughMessage = nextMessages[nextMessages.length - 1];
      if (admin && result.conversation && readThroughMessage &&
        (result.conversation.unread_count > 0 || nextMessages.some((item) => item.sender_type === "staff" && !item.seen_by_admin_at))) {
        const readHeaders = await getHeaders(true);
        if (!isCurrentRequest()) return;
        const readResponse = await fetch("/api/admin/staff-chat", {
          method: "PATCH",
          headers: readHeaders,
          body: JSON.stringify({ conversationId: result.conversation.id, readThroughMessageId: readThroughMessage.id }),
          signal,
        });
        const readResult = await readResponse.json();
        if (!readResponse.ok) throw new Error(readResult.error ?? "Could not mark this staff conversation as read.");
        if (!isCurrentRequest()) return;
        updatedConversation = { ...result.conversation, ...readResult.conversation };
        setMessages((current) => current.map((item) => ({
          ...item,
          seen_by_admin_at: item.sender_type === "staff" ? item.seen_by_admin_at ?? readResult.seenAt : item.seen_by_admin_at,
        })));
      }

      if (updatedConversation) {
        const nextConversations = conversationsRef.current.map((item) => item.id === updatedConversation?.id
          ? { ...item, ...updatedConversation }
          : item);
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
        if (admin) onUnreadCount(nextConversations.reduce((total, item) => total + item.unread_count, 0));
      }
      if (!admin) onUnreadCount(result.unreadCount ?? 0);
    } catch (error) {
      if (isCurrentRequest()) onNotice(error instanceof Error ? error.message : "Could not load this chat.");
    } finally {
      if (isCurrentRequest()) setConversationLoading(false);
    }
  }, [admin, getHeaders, onNotice, onUnreadCount]);

  useEffect(() => {
    setLoading(true);
    void loadConversations();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversations();
    }, 20_000);
    return () => {
      window.clearInterval(interval);
      conversationsRequestIdRef.current += 1;
    };
  }, [admin, loadConversations]);

  useEffect(() => {
    if (!admin || !selectedStaffMemberId) {
      if (admin && !selectedStaffMemberId) setMessages([]);
      return;
    }
    const controller = new AbortController();
    setMessages([]);
    setSelectedMessageIds(new Set());
    setReplyTo(null);
    setConversationLoading(true);
    if (document.visibilityState === "visible") void loadMessages(selectedId, selectedStaffMemberId, controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadMessages(selectedId, selectedStaffMemberId, controller.signal);
    }, 10_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [admin, loadMessages, selectedId, selectedStaffMemberId]);

  useEffect(() => {
    const element = messageListRef.current;
    if (element && shouldScrollToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      shouldScrollToBottomRef.current = false;
    }
  }, [messages]);

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = reply.trim();
    if ((!message && !files.length) || sending || (admin && !selectedStaffMemberId)) return;
    setSending(true);
    try {
      const form = new FormData();
      form.set("message", message);
      if (replyTo) form.set("replyToMessageId", replyTo.id);
      if (admin && selectedId) form.set("conversationId", selectedId);
      if (admin && selectedStaffMemberId) form.set("staffMemberId", String(selectedStaffMemberId));
      for (const file of files) form.append("attachments", file);
      const response = await fetch(admin ? "/api/admin/staff-chat" : "/api/staff/admin-chat", {
        method: "POST",
        headers: await getHeaders(),
        body: form,
      });
      let result: { error?: string; conversation?: { id: string } };
      try {
        result = await response.json();
      } catch {
        if (response.status === 413) {
          throw new Error("Attachments must total 4 MB or less per message. Choose fewer or smaller files.");
        }
        throw new Error("The server returned an invalid response. Please try sending smaller files.");
      }
      if (!response.ok) throw new Error(result.error ?? "Could not send your message.");
      setReply("");
      setReplyTo(null);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadConversations();
      if (result.conversation?.id) {
        setSelectedId(result.conversation.id);
        shouldScrollToBottomRef.current = true;
        await loadMessages(result.conversation.id, selectedStaffMemberId ?? undefined);
      } else if (selectedStaffMemberId) {
        shouldScrollToBottomRef.current = true;
        await loadMessages(selectedId, selectedStaffMemberId);
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
      selectedIdRef.current = null;
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
      await loadMessages(selectedId, selectedStaffMemberId ?? undefined);
      await loadConversations();
      onNotice("Selected messages deleted.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete the selected messages.");
    }
  };
  const deleteSelectedMessages = async () => deleteMessages([...selectedMessageIds]);

  const selectedConversation = conversations.find((item) => item.staff_member_id === selectedStaffMemberId) ?? null;
  return <div className={`support-inbox staff-admin-chat${admin ? "" : " is-staff-chat"}${admin ? mobileConversationOpen ? " is-conversation-open" : "" : " is-conversation-open"}`}>
    {admin ? <aside className="support-thread-list">
      <div className="support-list-heading"><strong>Staff conversations</strong></div>
      <div className="support-thread-scroll">
        {loading ? <p className="admin-empty">Loading staff conversations…</p> : conversations.length ? conversations.map((item) =>
          <button type="button" key={item.staff_member_id} className={`support-thread${selectedStaffMemberId === item.staff_member_id ? " is-selected" : ""}`} onClick={() => {
            selectedStaffMemberIdRef.current = item.staff_member_id;
            selectedIdRef.current = item.id;
            setSelectedStaffMemberId(item.staff_member_id);
            setSelectedId(item.id);
            shouldScrollToBottomRef.current = true;
            setMessages([]);
            setSelectedMessageIds(new Set());
            setConversationLoading(true);
            setReplyTo(null);
            setMobileConversationOpen(true);
          }}>
            <span><strong>{item.employee_code}</strong><small>{item.full_name}</small></span>
            <b>{item.unread_count > 0 ? `New from ${item.full_name}` : item.id ? "Direct chat" : "Start a chat"}</b>
            {item.last_message_at && <em>{new Date(item.last_message_at).toLocaleString()}</em>}
            {item.unread_count > 0 && <i>{item.unread_count} unread</i>}
          </button>,
        ) : <p className="admin-empty">No active staff accounts found.</p>}
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
            {admin && selectedConversation && !selectedId && <small>Start a new direct conversation with this staff member.</small>}
          </div>
          <div className="staff-chat-conversation-actions">
            <button className="button button-outline staff-chat-delete-conversation" type="button" aria-label="Delete conversation for everyone" title="Delete conversation for everyone" onClick={() => void clearConversation()} disabled={!selectedId}>Delete chat</button>
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
            if (selectedFiles.reduce((total, file) => total + file.size, 0) > maxTotalAttachmentSize) {
              onNotice("Attachments must total 4 MB or less per message. Choose fewer or smaller files.");
              event.target.value = "";
              setFiles([]);
              return;
            }
            setFiles(selectedFiles);
          }} /></label>
          <small>Up to 5 files per message; images, PDF, TXT, DOCX, or XLSX, 4 MB total.</small>
          <button className="button button-dark" type="submit" disabled={sending || (!reply.trim() && !files.length) || (admin && !selectedStaffMemberId)}>{sending ? "Sending…" : "Send message"}</button>
        </form>
      </> : <p className="support-empty">{loading ? "Loading staff conversations…" : "Select a staff conversation."}</p>}
    </section>
  </div>;
}
