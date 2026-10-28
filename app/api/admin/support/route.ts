import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/admin-auth";

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId")?.trim() ?? "";
  if (threadId) {
    const { data: thread, error } = await admin.from("support_threads").select("*,website_accounts(id,display_name,username,email,phone)").eq("id", threadId).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not load the support conversation." }, { status: 503 });
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const { data: messages, error: messagesError } = await admin.from("support_messages").select("id,sender_type,sender_id,message,created_at,support_attachments(id,file_name,file_path,file_type,file_size)").eq("thread_id", threadId).order("created_at", { ascending: true });
    if (messagesError) return NextResponse.json({ error: "Could not load the support conversation." }, { status: 503 });
    const signedUrls: Record<string, string> = {};
    for (const message of messages ?? []) for (const attachment of ((message.support_attachments as { file_path: string }[] | null) ?? [])) {
      const signed = await admin.storage.from("support-attachments").createSignedUrl(attachment.file_path, 60 * 15);
      if (signed.data?.signedUrl) signedUrls[attachment.file_path] = signed.data.signedUrl;
    }
    const resultMessages = (messages ?? []).map((message: Record<string, unknown>) => ({ ...message, support_attachments: ((message.support_attachments as { id: string; file_name: string; file_path: string; file_type: string; file_size: number }[] | null) ?? []).map((attachment) => ({ ...attachment, signed_url: signedUrls[attachment.file_path] ?? null })) }));
    await admin.from("support_threads").update({ unread_by_admin: false }).eq("id", threadId);
    return NextResponse.json({ thread, messages: resultMessages }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await admin.from("support_threads").select("*,website_accounts(id,display_name,username,email,phone)").order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load the support inbox." }, { status: 503 });
  return NextResponse.json({ threads: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try {
    const values = await request.json() as Record<string, unknown>;
    const threadId = typeof values.threadId === "string" ? values.threadId : "";
    if (!threadId) return NextResponse.json({ error: "Select a support conversation." }, { status: 400 });
    if (typeof values.internalNote === "string") {
      const { error } = await admin.from("support_threads").update({ internal_note: values.internalNote.slice(0, 5000), updated_at: new Date().toISOString() }).eq("id", threadId);
      if (error) throw error;
      return NextResponse.json({ saved: true });
    }
    const status = typeof values.status === "string" ? values.status : "";
    if (!["open","admin_replied","pending_user","resolved"].includes(status)) return NextResponse.json({ error: "Choose a valid support status." }, { status: 400 });
    const reply = typeof values.reply === "string" ? values.reply.trim() : "";
    if (reply) {
      if (reply.length > 5000) return NextResponse.json({ error: "Replies must be 5,000 characters or fewer." }, { status: 400 });
      const { error: messageError } = await admin.from("support_messages").insert({ thread_id: threadId, sender_type: "admin", sender_id: null, message: reply });
      if (messageError) throw messageError;
    }
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status, unread_by_admin: false, unread_by_user: Boolean(reply), updated_at: now }; if (reply) update.last_message_at = now;
    const { error } = await admin.from("support_threads").update(update).eq("id", threadId);
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: "Could not update the support conversation." }, { status: 503 });
  }
}
