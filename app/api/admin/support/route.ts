import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/admin-auth";
import {
  deleteSupportConversation,
  getSupportAttachments,
  getSupportFiles,
  getSupportUnreadCounts,
  markSupportMessagesSeen,
  refreshSupportUnreadFlags,
  removeSupportMessages,
  saveSupportAttachments,
  validateSupportFiles,
} from "@/lib/support-inbox";
import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";
import { recordStaffTaskCompletion } from "@/lib/staff-task-completions";

export async function GET(request: Request) {
  const admin = await getAdminClient(request, "customer_support");
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId")?.trim() ?? "";
  if (threadId) {
    const { data: thread, error } = await admin.from("support_threads")
      .select("*,website_accounts(id,display_name,username,email,phone)").eq("id", threadId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load the support conversation." }, { status: 503 });
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const { data: messages, error: messagesError } = await admin.from("support_messages")
      .select("id,sender_type,sender_id,message,created_at,seen_by_admin_at,seen_by_user_at,support_attachments(id,file_name,file_path,file_type,file_size)")
      .eq("thread_id", threadId).order("created_at", { ascending: true });
    if (messagesError) return NextResponse.json({ error: "Could not load the support conversation." }, { status: 503 });

    try {
      const messageRows = messages ?? [];
      const [attachments, seen] = await Promise.all([
        getSupportAttachments(admin, messageRows),
        markSupportMessagesSeen(admin, messageRows, "admin"),
      ]);
      await refreshSupportUnreadFlags(admin, threadId);
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
        .select("*,website_accounts(id,display_name,username,email,phone)").eq("id", threadId).single();
      if (refreshedThreadError) throw refreshedThreadError;
      return NextResponse.json({ thread: refreshedThread, messages: resultMessages }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Could not prepare the support conversation.", error);
      return NextResponse.json({ error: "Could not load the support conversation." }, { status: 503 });
    }
  }
  if (url.searchParams.get("unreadOnly") === "1") {
    const { data: unreadThreads, error: unreadError } = await admin.from("support_threads")
      .select("id").eq("unread_by_admin", true);
    if (unreadError) return NextResponse.json({ error: "Could not load unread support messages." }, { status: 503 });
    try {
      const unreadCounts = await getSupportUnreadCounts(admin, (unreadThreads ?? []).map((thread) => thread.id), "admin");
      return NextResponse.json({ unread_count: [...unreadCounts.values()].reduce((total, count) => total + count, 0) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Could not count unread support messages.", error);
      return NextResponse.json({ error: "Could not load unread support messages." }, { status: 503 });
    }
  }
  const { data, error } = await admin.from("support_threads")
    .select("*,website_accounts(id,display_name,username,email,phone)").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load the support inbox." }, { status: 503 });
  try {
    const threads = data ?? [];
    const unreadCounts = await getSupportUnreadCounts(admin, threads.map((thread) => thread.id), "admin");
    return NextResponse.json({
      threads: threads.map((thread) => ({ ...thread, unread_count: unreadCounts.get(thread.id) ?? 0 })),
      unread_count: [...unreadCounts.values()].reduce((total, count) => total + count, 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not count unread support messages.", error);
    return NextResponse.json({ error: "Could not load the support inbox." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const admin = await getAdminClient(request, "customer_support");
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const staff = await getStaffAccess(request, "customer_support");
  try {
    const values = await request.json() as { threadId?: unknown; clearConversation?: unknown; messageIds?: unknown };
    const threadId = typeof values.threadId === "string" ? values.threadId.trim() : "";
    if (!threadId) return NextResponse.json({ error: "Select a support conversation." }, { status: 400 });
    const { data: thread, error: threadError } = await admin.from("support_threads")
      .select("id").eq("id", threadId).maybeSingle();
    if (threadError) throw threadError;
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (staff && !await ownsStaffTaskClaim(admin, staff.staffId, "support_thread", threadId)) {
      return NextResponse.json({ error: "Claim this support conversation before handling it." }, { status: 409 });
    }

    if (values.clearConversation === true) {
      await deleteSupportConversation(admin, threadId);
      return NextResponse.json({ deleted: true, conversation: true });
    }
    const messageIds = Array.isArray(values.messageIds)
      ? [...new Set(values.messageIds.filter((value): value is string => typeof value === "string"))]
      : [];
    if (!messageIds.length || messageIds.length > 100) {
      return NextResponse.json({ error: "Select between 1 and 100 of your messages to delete." }, { status: 400 });
    }
    const { data: messages, error: messagesError } = await admin.from("support_messages")
      .select("id,sender_type").eq("thread_id", threadId).in("id", messageIds);
    if (messagesError) throw messagesError;
    if ((messages ?? []).length !== messageIds.length) return NextResponse.json({ error: "One or more messages were not found." }, { status: 404 });
    if (messages?.some((message) => message.sender_type !== "admin")) {
      return NextResponse.json({ error: "You can delete only your own messages." }, { status: 403 });
    }
    await removeSupportMessages(admin, messages ?? []);
    await refreshSupportUnreadFlags(admin, threadId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Could not delete the support conversation.", error);
    return NextResponse.json({ error: "Could not delete the support conversation." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAdminClient(request, "customer_support");
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const staff = await getStaffAccess(request, "customer_support");
  try {
    const isMultipart = request.headers.get("content-type")?.includes("multipart/form-data") ?? false;
    let form: FormData | null = null;
    let values: Record<string, unknown>;
    if (isMultipart) {
      form = await request.formData();
      values = {
          threadId: form.get("threadId"),
          status: form.get("status"),
          reply: form.get("reply"),
      };
    } else {
      values = await request.json() as Record<string, unknown>;
    }
    const threadId = typeof values.threadId === "string" ? values.threadId.trim() : "";
    if (!threadId) return NextResponse.json({ error: "Select a support conversation." }, { status: 400 });
    if (staff && !await ownsStaffTaskClaim(admin, staff.staffId, "support_thread", threadId)) {
      return NextResponse.json({ error: "Claim this support conversation before handling it." }, { status: 409 });
    }
    const { data: currentThread, error: currentThreadError } = await admin.from("support_threads")
      .select("status").eq("id", threadId).maybeSingle();
    if (currentThreadError) throw currentThreadError;
    if (!currentThread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    if (!form && typeof values.internalNote === "string") {
      const { error } = await admin.from("support_threads")
        .update({ internal_note: values.internalNote.slice(0, 5000), updated_at: new Date().toISOString() })
        .eq("id", threadId);
      if (error) throw error;
      return NextResponse.json({ saved: true });
    }

    const files = form ? getSupportFiles(form) : [];
    const fileError = validateSupportFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
    const reply = typeof values.reply === "string" ? values.reply.trim() : "";
    if (reply.length > 5000) return NextResponse.json({ error: "Replies must be 5,000 characters or fewer." }, { status: 400 });
    const status = typeof values.status === "string" && values.status
      ? values.status
      : reply || files.length ? "admin_replied" : "";
    if (!["open", "admin_replied", "pending_user", "resolved"].includes(status)) {
      return NextResponse.json({ error: "Choose a valid support status." }, { status: 400 });
    }
    if (reply || files.length) {
      const message = reply || "Attachment";
      const { data: supportMessage, error: messageError } = await admin.from("support_messages").insert({
        thread_id: threadId,
        sender_type: "admin",
        sender_id: null,
        message,
      }).select("id").single();
      if (messageError || !supportMessage) throw messageError ?? new Error("Could not save the reply.");
      try {
        await saveSupportAttachments(admin, files, "admin", threadId, supportMessage.id);
      } catch (attachmentError) {
        await removeSupportMessages(admin, [{ id: supportMessage.id }]);
        throw attachmentError;
      }
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status, updated_at: now };
    if (reply || files.length) update.last_message_at = now;
    const { error } = await admin.from("support_threads").update(update).eq("id", threadId);
    if (error) throw error;
    await refreshSupportUnreadFlags(admin, threadId);
    if (status === "resolved" && currentThread.status !== "resolved") {
      await recordStaffTaskCompletion(admin, staff, "support_thread", threadId, "resolve_conversation");
    }
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Could not update the support conversation.", error);
    return NextResponse.json({ error: "Could not update the support conversation." }, { status: 503 });
  }
}
