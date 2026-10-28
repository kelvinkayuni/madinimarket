import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

const categories = new Set(["Account", "Subscription", "Payment", "Product listing", "Order", "Other"]);

export async function GET(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to access support." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("support_threads").select("id,ticket_number,category,subject,status,unread_by_user,created_at,updated_at,last_message_at").eq("website_user_id", accountId).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load your support messages." }, { status: 503 });
  return NextResponse.json({ threads: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to contact support." }, { status: 401 });
  try {
    const form = await request.formData();
    const category = String(form.get("category") ?? "");
    const subject = String(form.get("subject") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    if (!categories.has(category) || subject.length < 3 || subject.length > 160 || message.length < 1 || message.length > 5000) return NextResponse.json({ error: "Choose a category and enter a valid subject and message." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { count } = await admin.from("support_threads").select("id", { count: "exact", head: true });
    const ticketNumber = `MM-${new Date().getUTCFullYear()}-${String((count ?? 0) + 1).padStart(5, "0")}`;
    const { data: thread, error: threadError } = await admin.from("support_threads").insert({ ticket_number: ticketNumber, website_user_id: accountId, category, subject, status: "open", unread_by_admin: true }).select("id,ticket_number").single();
    if (threadError || !thread) throw threadError ?? new Error("Could not create support ticket.");
    const { data: supportMessage, error: messageError } = await admin.from("support_messages").insert({ thread_id: thread.id, sender_type: "user", sender_id: accountId, message }).select("id").single();
    if (messageError || !supportMessage) throw messageError ?? new Error("Could not save support message.");
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File);
    for (const file of files) {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > 4194304) { await admin.from("support_threads").delete().eq("id", thread.id); return NextResponse.json({ error: "Attachments must be PDF, JPEG, or PNG and no larger than 4 MB." }, { status: 400 }); }
      const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const filePath = `${accountId}/${thread.id}/${randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage.from("support-attachments").upload(filePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: attachmentError } = await admin.from("support_attachments").insert({ message_id: supportMessage.id, file_name: file.name.slice(0, 255), file_path: filePath, file_type: file.type, file_size: file.size });
      if (attachmentError) throw attachmentError;
    }
    return NextResponse.json({ thread: { ...thread, status: "open" } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not submit your support request." }, { status: 503 });
  }
}
