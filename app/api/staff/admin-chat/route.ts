import { NextResponse } from "next/server";
import { getStaffAccess } from "@/lib/staff-auth";
import { deleteStaffChatConversation, getStaffChatUnreadCount, getStaffChatAttachments, removeStaffChatMessages, saveStaffChatAttachments } from "@/lib/staff-admin-chat";

export async function GET(request: Request) {
  const staff = await getStaffAccess(request);
  if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });

  const unreadOnly = new URL(request.url).searchParams.get("unreadOnly") === "1";
  const { data: conversation, error } = await staff.admin.from("staff_admin_conversations")
    .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,last_read_by_staff,staff_cleared_at")
    .eq("staff_member_id", staff.staffId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load your admin chat." }, { status: 503 });
  if (!conversation) return NextResponse.json({ conversation: null, messages: [], unreadCount: 0 }, { headers: { "Cache-Control": "no-store" } });

  if (unreadOnly) {
    try {
      const unreadCount = await getStaffChatUnreadCount(staff.admin, conversation.id, "admin", conversation.last_read_by_staff);
      return NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "Could not load your unread message count." }, { status: 503 });
    }
  }

  const { data: messages, error: messagesError } = await staff.admin.from("staff_admin_messages")
    .select("id,sender_type,message,created_at,seen_by_admin_at,seen_by_staff_at,reply_to_message_id,reply_to_sender_type,reply_to_message")
    .eq("conversation_id", conversation.id)
    .gt("created_at", conversation.staff_cleared_at ?? "1970-01-01T00:00:00.000Z")
    .order("created_at", { ascending: true });
  if (messagesError) return NextResponse.json({ error: "Could not load your admin chat." }, { status: 503 });
  let attachments: Map<string, { id: string; file_name: string; file_type: string; file_size: number; signed_url: string }[]>;
  try {
    attachments = await getStaffChatAttachments(staff.admin, messages ?? []);
  } catch {
    return NextResponse.json({ error: "Could not load chat attachments." }, { status: 503 });
  }
  const now = new Date().toISOString();
  const unseenAdminMessages = (messages ?? []).filter((message) => message.sender_type === "admin" && !message.seen_by_staff_at).map((message) => message.id);
  if (unseenAdminMessages.length) {
    const { error: seenError } = await staff.admin.from("staff_admin_messages")
      .update({ seen_by_staff_at: now })
      .in("id", unseenAdminMessages);
    if (seenError) return NextResponse.json({ error: "Could not update message read receipts." }, { status: 503 });
  }
  const { error: updateError } = await staff.admin.from("staff_admin_conversations")
    .update({ unread_by_staff: false, last_read_by_staff: now })
    .eq("id", conversation.id);
  if (updateError) return NextResponse.json({ error: "Could not update your chat status." }, { status: 503 });

  return NextResponse.json({
    conversation: { ...conversation, unread_by_staff: false, unread_count: 0, full_name: staff.fullName },
    messages: (messages ?? []).map((message) => ({
      ...message,
      seen_by_staff_at: message.sender_type === "admin" ? message.seen_by_staff_at ?? now : message.seen_by_staff_at,
      attachments: attachments.get(message.id) ?? [],
    })),
    unreadCount: 0,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await getStaffAccess(request);
  if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });

  try {
    const form = await request.formData();
    const message = String(form.get("message") ?? "").trim();
    const replyToMessageId = String(form.get("replyToMessageId") ?? "").trim();
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    if ((!message && !files.length) || message.length > 5000) {
      return NextResponse.json({ error: "Enter a message between 1 and 5,000 characters." }, { status: 400 });
    }

    const { data: existingConversation, error } = await staff.admin.from("staff_admin_conversations")
      .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
      .eq("staff_member_id", staff.staffId)
      .maybeSingle();
    if (error) throw error;
    let conversation = existingConversation;
    if (!conversation) {
      const created = await staff.admin.from("staff_admin_conversations")
        .insert({ staff_member_id: staff.staffId })
        .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
        .single();
      if (created.error) {
        const existing = await staff.admin.from("staff_admin_conversations")
          .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
          .eq("staff_member_id", staff.staffId)
          .maybeSingle();
        if (existing.error || !existing.data) throw created.error;
        conversation = existing.data;
      } else {
        conversation = created.data;
      }
    }

    let replySnapshot: { id: string; sender_type: "staff" | "admin"; message: string } | null = null;
    if (replyToMessageId) {
      const { data: target, error: targetError } = await staff.admin.from("staff_admin_messages")
        .select("id,sender_type,message")
        .eq("conversation_id", conversation.id)
        .eq("id", replyToMessageId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return NextResponse.json({ error: "The message you are replying to is unavailable." }, { status: 400 });
      replySnapshot = target;
    }

    const now = new Date().toISOString();
    const { data: savedMessage, error: messageError } = await staff.admin.from("staff_admin_messages")
      .insert({
        conversation_id: conversation.id,
        sender_type: "staff",
        sender_staff_member_id: staff.staffId,
        message: message || "Attachment",
        reply_to_message_id: replySnapshot?.id ?? null,
        reply_to_sender_type: replySnapshot?.sender_type ?? null,
        reply_to_message: replySnapshot?.message ?? null,
      })
      .select("id")
      .single();
    if (messageError) throw messageError;
    try {
      await saveStaffChatAttachments(staff.admin, files, conversation.id, savedMessage.id, staff.staffId);
    } catch (error) {
      await staff.admin.from("staff_admin_messages").delete().eq("id", savedMessage.id);
      throw error;
    }
    const { error: updateError } = await staff.admin.from("staff_admin_conversations")
      .update({ unread_by_admin: true, unread_by_staff: false, updated_at: now, last_message_at: now })
      .eq("id", conversation.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      sent: true,
      conversation: { ...conversation, unread_by_admin: true, unread_by_staff: false, updated_at: now, last_message_at: now, full_name: staff.fullName },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send your message.";
    const isInputError = message.startsWith("Attach no more than") || message.startsWith("Attachments must total") || message.startsWith("Files must be");
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 503 });
  }
}

export async function DELETE(request: Request) {
  const staff = await getStaffAccess(request);
  if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });

  try {
    const values = await request.json() as Record<string, unknown>;
    const { data: conversation, error } = await staff.admin.from("staff_admin_conversations")
      .select("id")
      .eq("staff_member_id", staff.staffId)
      .maybeSingle();
    if (error) throw error;
    if (!conversation) return NextResponse.json({ error: "There is no conversation to clear." }, { status: 404 });

    if (values.clearConversation === true) {
      await deleteStaffChatConversation(staff.admin, conversation.id);
      return NextResponse.json({ deleted: true });
    }

    const messageIds = Array.isArray(values.messageIds)
      ? [...new Set(values.messageIds.filter((id): id is string => typeof id === "string"))]
      : [];
    if (!messageIds.length || messageIds.length > 100) return NextResponse.json({ error: "Select up to 100 of your own messages to delete." }, { status: 400 });
    const { data: messages, error: messagesError } = await staff.admin.from("staff_admin_messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("sender_type", "staff")
      .eq("sender_staff_member_id", staff.staffId)
      .in("id", messageIds);
    if (messagesError) throw messagesError;
    if (messages?.length !== messageIds.length) return NextResponse.json({ error: "You can delete only your own messages." }, { status: 403 });
    await removeStaffChatMessages(staff.admin, messages);
    return NextResponse.json({ deleted: messageIds.length });
  } catch {
    return NextResponse.json({ error: "Could not update your staff chat." }, { status: 503 });
  }
}
