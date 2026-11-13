import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to access support." }, { status: 401 });
  const { id } = await context.params;
  const admin = createSupabaseAdminClient();
  const { data: thread, error } = await admin.from("support_threads").select("*").eq("id", id).eq("website_user_id", accountId).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the conversation." }, { status: 503 });
  if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { data: messages, error: messagesError } = await admin.from("support_messages").select("id,sender_type,sender_id,message,created_at,support_attachments(id,file_name,file_path,file_type,file_size)").eq("thread_id", id).order("created_at", { ascending: true });
  if (messagesError) return NextResponse.json({ error: "Could not load the conversation." }, { status: 503 });
  const attachments = (messages ?? []).flatMap((message: Record<string, unknown>) => (message.support_attachments as { file_path: string }[] | null) ?? []);
  const signed = await Promise.all(attachments.map((attachment) => admin.storage.from("support-attachments").createSignedUrl(attachment.file_path, 60 * 15).then((result) => [attachment.file_path, result.data?.signedUrl ?? null] as const)));
  const signedUrls = Object.fromEntries(signed.filter((entry) => entry[1]));
  const resultMessages = (messages ?? []).map((message: Record<string, unknown>) => ({ ...message, support_attachments: ((message.support_attachments as { id: string; file_name: string; file_path: string; file_type: string; file_size: number }[] | null) ?? []).map((attachment) => ({ ...attachment, signed_url: signedUrls[attachment.file_path] ?? null })) }));
  await admin.from("support_threads").update({ unread_by_user: false }).eq("id", id);
  return NextResponse.json({ thread, messages: resultMessages }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to reply." }, { status: 401 });
  const { id } = await context.params;
  try {
    const form = await request.formData();
    const message = String(form.get("message") ?? "").trim();
    if (!message || message.length > 5000) return NextResponse.json({ error: "Enter a message between 1 and 5,000 characters." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { data: thread } = await admin.from("support_threads").select("id,website_user_id,status").eq("id", id).eq("website_user_id", accountId).maybeSingle();
    if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const { data: supportMessage, error } = await admin.from("support_messages").insert({ thread_id: id, sender_type: "user", sender_id: accountId, message }).select("id").single();
    if (error || !supportMessage) throw error ?? new Error("Could not send reply.");
    const files = form.getAll("attachments").filter((item): item is File =>
      item instanceof File && !(item.name === "" && item.size === 0),
    );
    for (const value of files) {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(value.type) || value.size < 1 || value.size > 4194304) return NextResponse.json({ error: "Attachments must be PDF, JPEG, or PNG and no larger than 4 MB." }, { status: 400 });
      const extension = value.type === "application/pdf" ? "pdf" : value.type === "image/png" ? "png" : "jpg";
      const filePath = `${accountId}/${id}/${randomUUID()}.${extension}`;
      await admin.storage.from("support-attachments").upload(filePath, await value.arrayBuffer(), { contentType: value.type, upsert: false });
      await admin.from("support_attachments").insert({ message_id: supportMessage.id, file_name: value.name.slice(0, 255), file_path: filePath, file_type: value.type, file_size: value.size });
    }
    await admin.from("support_threads").update({ status: "pending_user", unread_by_admin: true, unread_by_user: false, updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ sent: true });
  } catch {
    return NextResponse.json({ error: "Could not send your reply." }, { status: 503 });
  }
}
