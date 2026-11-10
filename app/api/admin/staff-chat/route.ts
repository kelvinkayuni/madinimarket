import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/admin-auth";
import { getStaffChatUnreadCount, getStaffChatAttachments, removeStaffChatMessages, saveStaffChatAttachments } from "@/lib/staff-admin-chat";

type ConversationRow = {
  id: string;
  staff_member_id: number;
  unread_by_admin: boolean;
  unread_by_staff: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  last_read_by_admin: string;
  admin_cleared_at: string | null;
};

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const search = new URL(request.url).searchParams;
  const conversationId = search.get("conversationId")?.trim() ?? "";
  const unreadOnly = search.get("unreadOnly") === "1";
  if (conversationId) {
    const { data: conversation, error } = await admin.from("staff_admin_conversations")
      .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,admin_cleared_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    if (!conversation) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });
    const { data: staffMember, error: staffError } = await admin.from("staff_members")
      .select("id,full_name,employee_code")
      .eq("id", conversation.staff_member_id)
      .maybeSingle();
    if (staffError) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    const { data: messages, error: messagesError } = await admin.from("staff_admin_messages")
      .select("id,sender_type,message,created_at,seen_by_admin_at,seen_by_staff_at,reply_to_message_id,reply_to_sender_type,reply_to_message")
      .eq("conversation_id", conversationId)
      .gt("created_at", conversation.admin_cleared_at ?? "1970-01-01T00:00:00.000Z")
      .order("created_at", { ascending: true });
    if (messagesError) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    let attachments: Map<string, { id: string; file_name: string; file_type: string; file_size: number; signed_url: string }[]>;
    try {
      attachments = await getStaffChatAttachments(admin, messages ?? []);
    } catch {
      return NextResponse.json({ error: "Could not load chat attachments." }, { status: 503 });
    }
    const now = new Date().toISOString();
    const unseenStaffMessages = (messages ?? []).filter((message) => message.sender_type === "staff" && !message.seen_by_admin_at).map((message) => message.id);
    if (unseenStaffMessages.length) {
      const { error: seenError } = await admin.from("staff_admin_messages")
        .update({ seen_by_admin_at: now })
        .in("id", unseenStaffMessages);
      if (seenError) return NextResponse.json({ error: "Could not update message read receipts." }, { status: 503 });
    }
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: false, last_read_by_admin: now })
      .eq("id", conversationId);
    if (updateError) return NextResponse.json({ error: "Could not update this conversation status." }, { status: 503 });

    return NextResponse.json({
      conversation: { ...conversation, unread_by_admin: false, unread_count: 0, full_name: staffMember?.full_name ?? "Staff", employee_code: staffMember?.employee_code ?? "" },
      messages: (messages ?? []).map((message) => ({
        ...message,
        seen_by_admin_at: message.sender_type === "staff" ? message.seen_by_admin_at ?? now : message.seen_by_admin_at,
        attachments: attachments.get(message.id) ?? [],
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: rows, error } = await admin.from("staff_admin_conversations")
    .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,last_read_by_admin")
    .order("last_message_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  const conversations = (rows ?? []) as ConversationRow[];
  const staffIds = [...new Set(conversations.map((conversation) => conversation.staff_member_id))];
  const { data: staffMembers, error: staffError } = staffIds.length
    ? await admin.from("staff_members").select("id,full_name,employee_code").in("id", staffIds)
    : { data: [], error: null };
  if (staffError) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  const staffById = new Map((staffMembers ?? []).map((member) => [member.id, member]));
  try {
    const unreadCounts = await Promise.all(conversations.map((conversation) =>
      getStaffChatUnreadCount(admin, conversation.id, "staff", conversation.last_read_by_admin)));
    const result = conversations.map((conversation, index) => ({
      ...conversation,
      full_name: staffById.get(conversation.staff_member_id)?.full_name ?? "Staff",
      employee_code: staffById.get(conversation.staff_member_id)?.employee_code ?? "",
      unread_count: unreadCounts[index],
    }));
    return NextResponse.json({
      conversations: result,
      ...(unreadOnly ? { unreadCount: unreadCounts.reduce((total, count) => total + count, 0) } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load unread message counts." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const form = await request.formData();
    const conversationId = String(form.get("conversationId") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const replyToMessageId = String(form.get("replyToMessageId") ?? "").trim();
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    if (!conversationId || (!message && !files.length) || message.length > 5000) {
      return NextResponse.json({ error: "Select a conversation and enter a message of up to 5,000 characters." }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await admin.from("staff_admin_conversations")
      .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });

    let replySnapshot: { id: string; sender_type: "staff" | "admin"; message: string } | null = null;
    if (replyToMessageId) {
      const { data: target, error: targetError } = await admin.from("staff_admin_messages")
        .select("id,sender_type,message")
        .eq("conversation_id", conversationId)
        .eq("id", replyToMessageId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return NextResponse.json({ error: "The message you are replying to is unavailable." }, { status: 400 });
      replySnapshot = target;
    }

    const { data: savedMessage, error: messageError } = await admin.from("staff_admin_messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "admin",
        sender_staff_member_id: null,
        message: message || "Attachment",
        reply_to_message_id: replySnapshot?.id ?? null,
        reply_to_sender_type: replySnapshot?.sender_type ?? null,
        reply_to_message: replySnapshot?.message ?? null,
      })
      .select("id")
      .single();
    if (messageError) throw messageError;
    try {
      await saveStaffChatAttachments(admin, files, conversationId, savedMessage.id, conversation.staff_member_id);
    } catch (error) {
      await admin.from("staff_admin_messages").delete().eq("id", savedMessage.id);
      throw error;
    }
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now })
      .eq("id", conversationId);
    if (updateError) throw updateError;

    return NextResponse.json({ sent: true, conversation: { ...conversation, unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send your message.";
    const isInputError = message.startsWith("Attach no more than") || message.startsWith("Files must be");
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 503 });
  }
}

export async function DELETE(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const values = await request.json() as Record<string, unknown>;
    const conversationId = typeof values.conversationId === "string" ? values.conversationId.trim() : "";
    if (!conversationId) return NextResponse.json({ error: "Select a staff conversation." }, { status: 400 });
    const { data: conversation, error } = await admin.from("staff_admin_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!conversation) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });

    if (values.clearConversation === true) {
      const now = new Date().toISOString();
      const { data: unreadMessages, error: unreadError } = await admin.from("staff_admin_messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("sender_type", "staff")
        .is("seen_by_admin_at", null);
      if (unreadError) throw unreadError;
      const unreadIds = (unreadMessages ?? []).map((message) => message.id);
      if (unreadIds.length) {
        const { error: seenError } = await admin.from("staff_admin_messages")
          .update({ seen_by_admin_at: now })
          .in("id", unreadIds);
        if (seenError) throw seenError;
      }
      const { error: clearError } = await admin.from("staff_admin_conversations")
        .update({ admin_cleared_at: now, last_read_by_admin: now, unread_by_admin: false })
        .eq("id", conversationId);
      if (clearError) throw clearError;
      return NextResponse.json({ cleared: true });
    }

    const messageIds = Array.isArray(values.messageIds)
      ? [...new Set(values.messageIds.filter((id): id is string => typeof id === "string"))]
      : [];
    if (!messageIds.length || messageIds.length > 100) return NextResponse.json({ error: "Select up to 100 of your own messages to delete." }, { status: 400 });
    const { data: messages, error: messagesError } = await admin.from("staff_admin_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("sender_type", "admin")
      .in("id", messageIds);
    if (messagesError) throw messagesError;
    if (messages?.length !== messageIds.length) return NextResponse.json({ error: "You can delete only your own messages." }, { status: 403 });
    await removeStaffChatMessages(admin, messages);
    return NextResponse.json({ deleted: messageIds.length });
  } catch {
    return NextResponse.json({ error: "Could not update the staff conversation." }, { status: 503 });
  }
}
