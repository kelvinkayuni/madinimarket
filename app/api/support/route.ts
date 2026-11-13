import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  getSupportFiles,
  getSupportUnreadCounts,
  refreshSupportUnreadFlags,
  saveSupportAttachments,
  validateSupportFiles,
} from "@/lib/support-inbox";
import { getWebsiteAccountId } from "@/lib/website-session";

const categories = new Set(["Account", "Subscription", "Payment", "Product listing", "Order", "Other"]);

export async function GET(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again to access support." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (new URL(request.url).searchParams.get("unreadOnly") === "1") {
    const { data: unreadThreads, error: unreadError } = await admin.from("support_threads")
      .select("id").eq("website_user_id", accountId).eq("unread_by_user", true).is("hidden_by_user_at", null);
    if (unreadError) return NextResponse.json({ error: "Could not load unread support messages." }, { status: 503 });
    try {
      const unreadCounts = await getSupportUnreadCounts(admin, (unreadThreads ?? []).map((thread) => thread.id), "user");
      return NextResponse.json({ unread_count: [...unreadCounts.values()].reduce((total, count) => total + count, 0) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Could not count unread support messages.", error);
      return NextResponse.json({ error: "Could not load unread support messages." }, { status: 503 });
    }
  }
  const { data, error } = await admin.from("support_threads").select("id,ticket_number,category,subject,status,unread_by_user,created_at,updated_at,last_message_at").eq("website_user_id", accountId).is("hidden_by_user_at", null).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load your support messages." }, { status: 503 });
  try {
    const threads = data ?? [];
    const unreadCounts = await getSupportUnreadCounts(admin, threads.map((thread) => thread.id), "user");
    return NextResponse.json({
      threads: threads.map((thread) => ({ ...thread, unread_count: unreadCounts.get(thread.id) ?? 0 })),
      unread_count: [...unreadCounts.values()].reduce((total, count) => total + count, 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not count unread support messages.", error);
    return NextResponse.json({ error: "Could not load your support messages." }, { status: 503 });
  }
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
    const files = getSupportFiles(form);
    const fileError = validateSupportFiles(files);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { count } = await admin.from("support_threads").select("id", { count: "exact", head: true });
    const ticketNumber = `MM-${new Date().getUTCFullYear()}-${String((count ?? 0) + 1).padStart(5, "0")}`;
    const { data: thread, error: threadError } = await admin.from("support_threads").insert({ ticket_number: ticketNumber, website_user_id: accountId, category, subject, status: "open", unread_by_admin: true }).select("id,ticket_number").single();
    if (threadError || !thread) throw threadError ?? new Error("Could not create support ticket.");
    const { data: supportMessage, error: messageError } = await admin.from("support_messages").insert({ thread_id: thread.id, sender_type: "user", sender_id: accountId, message }).select("id").single();
    if (messageError || !supportMessage) throw messageError ?? new Error("Could not save support message.");
    try {
      await saveSupportAttachments(admin, files, accountId, thread.id, supportMessage.id);
    } catch (error) {
      const { error: cleanupError } = await admin.from("support_threads").delete().eq("id", thread.id);
      if (cleanupError) throw cleanupError;
      throw error;
    }
    await refreshSupportUnreadFlags(admin, thread.id);
    return NextResponse.json({ thread: { ...thread, status: "open" } }, { status: 201 });
  } catch (error) {
    console.error("Could not submit a support request.", error);
    return NextResponse.json({ error: "Could not submit your support request." }, { status: 503 });
  }
}
