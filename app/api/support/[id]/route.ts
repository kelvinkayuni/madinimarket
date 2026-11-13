import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  getSupportAttachments,
  getSupportFiles,
  markSupportMessagesSeen,
  refreshSupportUnreadFlags,
  removeSupportMessages,
  saveSupportAttachments,
  validateSupportFiles,
} from "@/lib/support-inbox";
import { getWebsiteAccountId } from "@/lib/website-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to access support." }, { status: 401 });
  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data: thread, error } = await admin.from("support_threads")
    .select("id,ticket_number,category,subject,status,unread_by_user,created_at,updated_at,last_message_at")
    .eq("id", id).eq("website_user_id", accountId).is("hidden_by_user_at", null).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the conversation." }, { status: 503 });
  if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const { data: messages, error: messagesError } = await admin.from("support_messages")
    .select("id,sender_type,sender_id,message,created_at,seen_by_admin_at,seen_by_user_at,support_attachments(id,file_name,file_path,file_type,file_size)")
    .eq("thread_id", id).is("hidden_by_user_at", null).order("created_at", { ascending: true });
  if (messagesError) return NextResponse.json({ error: "Could not load the conversation." }, { status: 503 });

  try {
    const messageRows = messages ?? [];
    const [attachments, seen] = await Promise.all([
      getSupportAttachments(admin, messageRows),
      markSupportMessagesSeen(admin, messageRows, "user"),
    ]);
    await refreshSupportUnreadFlags(admin, id);
    const resultMessages = messageRows.map((message) => ({
      ...message,
      ...(seen.seenColumn === "seen_by_admin_at"
        ? { seen_by_admin_at: seen.unseenIds.has(message.id) ? seen.seenAt : message.seen_by_admin_at }
        : { seen_by_user_at: seen.unseenIds.has(message.id) ? seen.seenAt : message.seen_by_user_at }),
      support_attachments: (message.support_attachments ?? []).map((attachment) => ({
        ...attachment,
        signed_url: attachments.get(message.id)?.find((item) => item.id === attachment.id)?.signed_url ?? null,
      })),
    }));
    const { data: refreshedThread, error: refreshedThreadError } = await admin.from("support_threads")
      .select("id,ticket_number,category,subject,status,unread_by_user,created_at,updated_at,last_message_at")
      .eq("id", id).eq("website_user_id", accountId).is("hidden_by_user_at", null).single();
    if (refreshedThreadError) throw refreshedThreadError;
    return NextResponse.json({ thread: refreshedThread, messages: resultMessages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not prepare the support conversation.", error);
    return NextResponse.json({ error: "Could not load the conversation." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to reply." }, { status: 401 });
  const { id } = await context.params;
  try {
    const form = await request.formData();
    const message = String(form.get("message") ?? "").trim();
    const files = getSupportFiles(form);
    if ((!message && !files.length) || message.length > 5000) {
      return NextResponse.json({ error: "Enter a message of up to 5,000 characters or attach a file." }, { status: 400 });
    }
    const fileError = validateSupportFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

    const admin = createSupabaseAdminClient();
    const { data: thread, error: threadError } = await admin.from("support_threads")
      .select("id,website_user_id,status").eq("id", id).eq("website_user_id", accountId).is("hidden_by_user_at", null).maybeSingle();
    if (threadError) throw threadError;
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const { data: supportMessage, error } = await admin.from("support_messages").insert({
      thread_id: id,
      sender_type: "user",
      sender_id: accountId,
      message: message || "Attachment",
    }).select("id").single();
    if (error || !supportMessage) throw error ?? new Error("Could not send reply.");

    try {
      await saveSupportAttachments(admin, files, accountId, id, supportMessage.id);
    } catch (attachmentError) {
      await removeSupportMessages(admin, [{ id: supportMessage.id }]);
      throw attachmentError;
    }
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("support_threads").update({
      status: "pending_user",
      updated_at: now,
      last_message_at: now,
    }).eq("id", id);
    if (updateError) throw updateError;
    await refreshSupportUnreadFlags(admin, id);
    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("Could not send a support reply.", error);
    return NextResponse.json({ error: "Could not send your reply." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to manage support messages." }, { status: 401 });
  const { id } = await context.params;
  try {
    const values = await request.json() as { clearConversation?: unknown; messageIds?: unknown };
    const admin = createSupabaseAdminClient();
    const { data: thread, error: threadError } = await admin.from("support_threads")
      .select("id").eq("id", id).eq("website_user_id", accountId).is("hidden_by_user_at", null).maybeSingle();
    if (threadError) throw threadError;
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    if (values.clearConversation === true) {
      const { error } = await admin.from("support_threads")
        .update({ hidden_by_user_at: new Date().toISOString() })
        .eq("id", id).eq("website_user_id", accountId);
      if (error) throw error;
      return NextResponse.json({ deleted: true, conversation: true, localOnly: true });
    }
    const messageIds = Array.isArray(values.messageIds)
      ? [...new Set(values.messageIds.filter((value): value is string => typeof value === "string"))]
      : [];
    if (!messageIds.length || messageIds.length > 100) {
      return NextResponse.json({ error: "Select between 1 and 100 of your messages to delete." }, { status: 400 });
    }
    const { data: messages, error: messagesError } = await admin.from("support_messages")
      .select("id,sender_type").eq("thread_id", id).in("id", messageIds);
    if (messagesError) throw messagesError;
    if ((messages ?? []).length !== messageIds.length) return NextResponse.json({ error: "One or more messages were not found." }, { status: 404 });
    if (messages?.some((message) => message.sender_type !== "user")) {
      return NextResponse.json({ error: "You can delete only your own messages." }, { status: 403 });
    }
    const { error: hideError } = await admin.from("support_messages")
      .update({ hidden_by_user_at: new Date().toISOString() })
      .eq("thread_id", id).in("id", messageIds);
    if (hideError) throw hideError;
    return NextResponse.json({ deleted: true, localOnly: true });
  } catch (error) {
    console.error("Could not delete support messages.", error);
    return NextResponse.json({ error: "Could not delete the support messages." }, { status: 503 });
  }
}
