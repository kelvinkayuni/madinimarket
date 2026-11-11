import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/admin-auth";
import { deleteStaffChatConversation, getStaffChatUnreadCount, getStaffChatAttachments, removeStaffChatMessages, saveStaffChatAttachments } from "@/lib/staff-admin-chat";

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
  const staffMemberId = Number(search.get("staffMemberId"));
  const unreadOnly = search.get("unreadOnly") === "1";
  if (conversationId || (Number.isSafeInteger(staffMemberId) && staffMemberId > 0)) {
    let conversation = null;
    if (conversationId) {
      const { data, error } = await admin.from("staff_admin_conversations")
        .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,last_read_by_admin,admin_cleared_at")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
      if (!data) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });
      conversation = data;
    } else {
      const { data, error } = await admin.from("staff_admin_conversations")
        .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,last_read_by_admin,admin_cleared_at")
        .eq("staff_member_id", staffMemberId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
      conversation = data;
    }

    const resolvedStaffMemberId = conversation?.staff_member_id ?? staffMemberId;
    const { data: staffMember, error: staffError } = await admin.from("staff_members")
      .select("id,full_name,employee_code")
      .eq("id", resolvedStaffMemberId)
      .eq("status", "active")
      .maybeSingle();
    if (staffError) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    if (!staffMember) return NextResponse.json({ error: "Active staff account not found." }, { status: 404 });
    if (!conversation) {
      return NextResponse.json({
        conversation: null,
        staffMember: { staff_member_id: staffMember.id, full_name: staffMember.full_name, employee_code: staffMember.employee_code },
        messages: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    let unreadCount: number;
    try {
      unreadCount = await getStaffChatUnreadCount(admin, conversation.id, "staff");
    } catch {
      return NextResponse.json({ error: "Could not load unread message counts." }, { status: 503 });
    }
    const { data: messages, error: messagesError } = await admin.from("staff_admin_messages")
      .select("id,sender_type,message,created_at,seen_by_admin_at,seen_by_staff_at,reply_to_message_id,reply_to_sender_type,reply_to_message")
      .eq("conversation_id", conversation.id)
      .gt("created_at", conversation.admin_cleared_at ?? "1970-01-01T00:00:00.000Z")
      .order("created_at", { ascending: true });
    if (messagesError) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    let attachments: Map<string, { id: string; file_name: string; file_type: string; file_size: number; signed_url: string }[]>;
    try {
      attachments = await getStaffChatAttachments(admin, messages ?? []);
    } catch {
      return NextResponse.json({ error: "Could not load chat attachments." }, { status: 503 });
    }
    return NextResponse.json({
      conversation: { ...conversation, unread_count: unreadCount, full_name: staffMember.full_name, employee_code: staffMember.employee_code },
      messages: (messages ?? []).map((message) => ({
        ...message,
        attachments: attachments.get(message.id) ?? [],
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: rows, error } = await admin.from("staff_admin_conversations")
    .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at,last_read_by_admin")
    .order("last_message_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  const conversations = (rows ?? []) as ConversationRow[];
  const { data: staffMembers, error: staffError } = await admin.from("staff_members")
    .select("id,full_name,employee_code")
    .eq("status", "active")
    .order("full_name", { ascending: true });
  if (staffError) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  try {
    const unreadCounts = await Promise.all(conversations.map((conversation) =>
      getStaffChatUnreadCount(admin, conversation.id, "staff")));
    const unreadByStaffId = new Map(conversations.map((conversation, index) => [conversation.staff_member_id, unreadCounts[index]]));
    const result = conversations.map((conversation, index) => ({
      ...conversation,
      unread_count: unreadCounts[index],
    }));
    const conversationsByStaff = new Map(result.map((conversation) => [conversation.staff_member_id, conversation]));
    const staffList = (staffMembers ?? []).map((member) => {
      const conversation = conversationsByStaff.get(member.id);
      return conversation ? {
        ...conversation,
        full_name: member.full_name,
        employee_code: member.employee_code,
      } : {
        id: null,
        staff_member_id: member.id,
        full_name: member.full_name,
        employee_code: member.employee_code,
        unread_count: 0,
        unread_by_admin: false,
        unread_by_staff: false,
        created_at: null,
        updated_at: null,
        last_message_at: null,
      };
    }).sort((a, b) => {
      const aUnread = unreadByStaffId.get(a.staff_member_id) ?? 0;
      const bUnread = unreadByStaffId.get(b.staff_member_id) ?? 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? ""));
    });
    return NextResponse.json({
      conversations: staffList,
      ...(unreadOnly ? { unreadCount: unreadCounts.reduce((total, count) => total + count, 0) } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load unread message counts." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const values = await request.json() as Record<string, unknown>;
    const conversationId = typeof values.conversationId === "string" ? values.conversationId.trim() : "";
    const readThroughMessageId = typeof values.readThroughMessageId === "string" ? values.readThroughMessageId.trim() : "";
    if (!conversationId || !readThroughMessageId) {
      return NextResponse.json({ error: "Select a conversation and its latest loaded message." }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await admin.from("staff_admin_conversations")
      .select("id,last_read_by_admin")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });

    const { data: readThroughMessage, error: messageError } = await admin.from("staff_admin_messages")
      .select("id,created_at")
      .eq("id", readThroughMessageId)
      .eq("conversation_id", conversation.id)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!readThroughMessage) return NextResponse.json({ error: "The loaded message is not part of this conversation." }, { status: 400 });

    const previousLastReadAt = Date.parse(conversation.last_read_by_admin ?? "");
    const readThroughAt = Date.parse(readThroughMessage.created_at);
    if (!Number.isFinite(readThroughAt)) throw new Error("The selected message has an invalid timestamp.");
    const lastReadAt = new Date(Math.max(
      Number.isFinite(previousLastReadAt) ? previousLastReadAt : 0,
      readThroughAt,
    )).toISOString();
    const now = new Date().toISOString();
    const { error: seenError } = await admin.from("staff_admin_messages")
      .update({ seen_by_admin_at: now })
      .eq("conversation_id", conversation.id)
      .eq("sender_type", "staff")
      .lte("created_at", readThroughMessage.created_at)
      .is("seen_by_admin_at", null);
    if (seenError) throw seenError;

    const unreadCount = await getStaffChatUnreadCount(admin, conversation.id, "staff");
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: unreadCount > 0, last_read_by_admin: lastReadAt })
      .eq("id", conversation.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      conversation: { id: conversation.id, unread_by_admin: unreadCount > 0, unread_count: unreadCount, last_read_by_admin: lastReadAt },
      seenAt: now,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not mark this staff conversation as read." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const form = await request.formData();
    let conversationId = String(form.get("conversationId") ?? "").trim();
    const requestedStaffMemberId = Number(form.get("staffMemberId"));
    const message = String(form.get("message") ?? "").trim();
    const replyToMessageId = String(form.get("replyToMessageId") ?? "").trim();
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    if ((!conversationId && (!Number.isSafeInteger(requestedStaffMemberId) || requestedStaffMemberId < 1)) ||
      (!message && !files.length) || message.length > 5000) {
      return NextResponse.json({ error: "Select a conversation and enter a message of up to 5,000 characters." }, { status: 400 });
    }

    let conversation = null;
    if (conversationId) {
      const { data, error: conversationError } = await admin.from("staff_admin_conversations")
        .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
        .eq("id", conversationId)
        .maybeSingle();
      if (conversationError) throw conversationError;
      conversation = data;
    } else {
      const { data: staffMember, error: staffError } = await admin.from("staff_members")
        .select("id")
        .eq("id", requestedStaffMemberId)
        .eq("status", "active")
        .maybeSingle();
      if (staffError) throw staffError;
      if (!staffMember) return NextResponse.json({ error: "Active staff account not found." }, { status: 404 });

      const { data: existing, error: existingError } = await admin.from("staff_admin_conversations")
        .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
        .eq("staff_member_id", staffMember.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        conversation = existing;
      } else {
        const { data: created, error: createError } = await admin.from("staff_admin_conversations")
          .insert({ staff_member_id: staffMember.id })
          .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
          .single();
        if (createError) {
          const { data: concurrent, error: concurrentError } = await admin.from("staff_admin_conversations")
            .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
            .eq("staff_member_id", staffMember.id)
            .maybeSingle();
          if (concurrentError || !concurrent) throw createError;
          conversation = concurrent;
        } else {
          conversation = created;
        }
      }
      conversationId = conversation.id;
    }
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
      .select("id,sender_type,message,created_at,seen_by_admin_at,seen_by_staff_at,reply_to_message_id,reply_to_sender_type,reply_to_message")
      .single();
    if (messageError) throw messageError;
    let attachments: Awaited<ReturnType<typeof getStaffChatAttachments>> | null = null;
    try {
      await saveStaffChatAttachments(admin, files, conversationId, savedMessage.id, conversation.staff_member_id);
      if (files.length) attachments = await getStaffChatAttachments(admin, [savedMessage]);
    } catch (error) {
      await removeStaffChatMessages(admin, [savedMessage]);
      throw error;
    }
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now })
      .eq("id", conversationId);
    if (updateError) throw updateError;

    return NextResponse.json({
      sent: true,
      conversation: { ...conversation, unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now },
      message: { ...savedMessage, attachments: attachments?.get(savedMessage.id) ?? [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send your message.";
    const isInputError = message.startsWith("Attach no more than") || message.startsWith("Attachments must total") || message.startsWith("Files must be");
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
      await deleteStaffChatConversation(admin, conversationId);
      return NextResponse.json({ deleted: true });
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
