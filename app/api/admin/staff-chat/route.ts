import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/admin-auth";

type ConversationRow = {
  id: string;
  staff_member_id: number;
  unread_by_admin: boolean;
  unread_by_staff: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim() ?? "";
  if (conversationId) {
    const { data: conversation, error } = await admin.from("staff_admin_conversations")
      .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
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
      .select("id,sender_type,message,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (messagesError) return NextResponse.json({ error: "Could not load this staff conversation." }, { status: 503 });
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: false })
      .eq("id", conversationId);
    if (updateError) return NextResponse.json({ error: "Could not update this conversation status." }, { status: 503 });

    return NextResponse.json({
      conversation: { ...conversation, unread_by_admin: false, full_name: staffMember?.full_name ?? "Staff", employee_code: staffMember?.employee_code ?? "" },
      messages: (messages ?? []).reverse(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: rows, error } = await admin.from("staff_admin_conversations")
    .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
    .order("last_message_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  const conversations = (rows ?? []) as ConversationRow[];
  const staffIds = [...new Set(conversations.map((conversation) => conversation.staff_member_id))];
  const { data: staffMembers, error: staffError } = staffIds.length
    ? await admin.from("staff_members").select("id,full_name,employee_code").in("id", staffIds)
    : { data: [], error: null };
  if (staffError) return NextResponse.json({ error: "Could not load staff conversations." }, { status: 503 });
  const staffById = new Map((staffMembers ?? []).map((member) => [member.id, member]));
  return NextResponse.json({
    conversations: conversations.map((conversation) => ({
      ...conversation,
      full_name: staffById.get(conversation.staff_member_id)?.full_name ?? "Staff",
      employee_code: staffById.get(conversation.staff_member_id)?.employee_code ?? "",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const values = await request.json() as Record<string, unknown>;
    const conversationId = typeof values.conversationId === "string" ? values.conversationId.trim() : "";
    const message = typeof values.message === "string" ? values.message.trim() : "";
    if (!conversationId || !message || message.length > 5000) {
      return NextResponse.json({ error: "Select a conversation and enter a message of up to 5,000 characters." }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await admin.from("staff_admin_conversations")
      .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return NextResponse.json({ error: "Staff conversation not found." }, { status: 404 });

    const { error: messageError } = await admin.from("staff_admin_messages")
      .insert({ conversation_id: conversationId, sender_type: "admin", sender_staff_member_id: null, message });
    if (messageError) throw messageError;
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("staff_admin_conversations")
      .update({ unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now })
      .eq("id", conversationId);
    if (updateError) throw updateError;

    return NextResponse.json({ sent: true, conversation: { ...conversation, unread_by_admin: false, unread_by_staff: true, updated_at: now, last_message_at: now } });
  } catch {
    return NextResponse.json({ error: "Could not send your message." }, { status: 503 });
  }
}
