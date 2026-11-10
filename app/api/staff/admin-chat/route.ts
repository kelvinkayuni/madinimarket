import { NextResponse } from "next/server";
import { getStaffAccess } from "@/lib/staff-auth";

export async function GET(request: Request) {
  const staff = await getStaffAccess(request);
  if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });

  const { data: conversation, error } = await staff.admin.from("staff_admin_conversations")
    .select("id,staff_member_id,unread_by_admin,unread_by_staff,created_at,updated_at,last_message_at")
    .eq("staff_member_id", staff.staffId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load your admin chat." }, { status: 503 });
  if (!conversation) return NextResponse.json({ conversation: null, messages: [] }, { headers: { "Cache-Control": "no-store" } });

  const { data: messages, error: messagesError } = await staff.admin.from("staff_admin_messages")
    .select("id,sender_type,message,created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (messagesError) return NextResponse.json({ error: "Could not load your admin chat." }, { status: 503 });
  const { error: updateError } = await staff.admin.from("staff_admin_conversations")
    .update({ unread_by_staff: false })
    .eq("id", conversation.id);
  if (updateError) return NextResponse.json({ error: "Could not update your chat status." }, { status: 503 });

  return NextResponse.json({
    conversation: { ...conversation, unread_by_staff: false, full_name: staff.fullName },
    messages: (messages ?? []).reverse(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const staff = await getStaffAccess(request);
  if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });

  try {
    const values = await request.json() as Record<string, unknown>;
    const message = typeof values.message === "string" ? values.message.trim() : "";
    if (!message || message.length > 5000) {
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

    const now = new Date().toISOString();
    const { error: messageError } = await staff.admin.from("staff_admin_messages")
      .insert({ conversation_id: conversation.id, sender_type: "staff", sender_staff_member_id: staff.staffId, message });
    if (messageError) throw messageError;
    const { error: updateError } = await staff.admin.from("staff_admin_conversations")
      .update({ unread_by_admin: true, unread_by_staff: false, updated_at: now, last_message_at: now })
      .eq("id", conversation.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      sent: true,
      conversation: { ...conversation, unread_by_admin: true, unread_by_staff: false, updated_at: now, last_message_at: now, full_name: staff.fullName },
    });
  } catch {
    return NextResponse.json({ error: "Could not send your message." }, { status: 503 });
  }
}
