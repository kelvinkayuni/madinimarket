import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getWebsiteAccountId } from "@/lib/website-session";

const certificateKinds = ["dealer", "broker"] as const;
type CertificateKind = typeof certificateKinds[number];
const maxFileSize = 10 * 1024 * 1024;

function isCertificateKind(value: FormDataEntryValue | null): value is CertificateKind {
  return typeof value === "string" && certificateKinds.includes(value as CertificateKind);
}

function identifyFile(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { extension: "pdf", contentType: "application/pdf" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", contentType: "image/jpeg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png", contentType: "image/png" };
  return null;
}

export async function GET() {
  try {
    const accountId = await getWebsiteAccountId();
    if (!accountId) return NextResponse.json({ error: "Sign in to view your licences." }, { status: 401 });
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("website_account_certificates")
      .select("id, kind, status, review_message, file_name, file_path, created_at")
      .eq("website_user_id", accountId);
    if (error) throw error;
    const certificates = await Promise.all((data ?? []).map(async (row) => {
      const { data: signed } = await admin.storage.from("account-certificates").createSignedUrl(row.file_path, 3600);
      return { ...row, signed_url: signed?.signedUrl ?? "" };
    }));
    return NextResponse.json({ certificates }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load your licences." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId();
  if (!accountId) return NextResponse.json({ error: "Sign in again before submitting a licence." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a licence file before submitting." }, { status: 400 });
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if (!isCertificateKind(kind) || !(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "Choose a dealer or broker licence file." }, { status: 400 });
  }
  if (file.size > maxFileSize) return NextResponse.json({ error: "Licence files must be 10 MB or smaller." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const identifiedFile = identifyFile(bytes);
  if (!identifiedFile) return NextResponse.json({ error: "Upload a PDF, JPEG, or PNG licence." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin.from("website_account_certificates")
    .select("id, status, file_path")
    .eq("website_user_id", accountId)
    .eq("kind", kind)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Could not check the current licence status." }, { status: 503 });
  if (existing && existing.status !== "rejected") {
    return NextResponse.json({ error: "This licence is already submitted or approved." }, { status: 409 });
  }

  const filePath = `${accountId}/${kind}/${randomUUID()}.${identifiedFile.extension}`;
  const { error: uploadError } = await admin.storage.from("account-certificates").upload(filePath, bytes, {
    contentType: identifiedFile.contentType,
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: "The licence file could not be uploaded." }, { status: 503 });

  const { data: certificate, error } = await admin.from("website_account_certificates").upsert({
    website_user_id: accountId,
    kind,
    status: "pending",
    review_message: null,
    file_name: file.name.slice(0, 200),
    file_path: filePath,
    reviewed_by: null,
    reviewed_at: null,
  }, { onConflict: "website_user_id,kind" })
    .select("id, kind, status, review_message, file_name, file_path, created_at")
    .single();
  if (error || !certificate) {
    await admin.storage.from("account-certificates").remove([filePath]);
    return NextResponse.json({ error: "The licence submission could not be saved." }, { status: 503 });
  }
  if (existing?.file_path) await admin.storage.from("account-certificates").remove([existing.file_path]);
  const { data: signed } = await admin.storage.from("account-certificates").createSignedUrl(filePath, 3600);
  return NextResponse.json({ certificate: { ...certificate, signed_url: signed?.signedUrl ?? "" } }, { status: 201 });
}