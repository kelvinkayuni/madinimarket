import { NextResponse } from "next/server";

import { getWebsiteAccountId } from "@/lib/website-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const noStore = { "Cache-Control": "no-store" };

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sixMonthsAfter(value: string) {
  const date = new Date(value);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 6);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date;
}

export async function GET(request: Request) {
  try {
    const accountId = await getWebsiteAccountId(request);
    if (!accountId) return NextResponse.json({ error: "Sign in to manage your bank information." }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("website_accounts")
      .select("bank_name, bank_account_number, bank_account_holder_name, bank_info_added_at, bank_info_updated_at, bank_info_edit_unlocked")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const editableDate = data.bank_info_updated_at ? sixMonthsAfter(data.bank_info_updated_at) : null;
    const editableAt = editableDate?.toISOString() ?? null;
    const canEdit = !data.bank_info_added_at || data.bank_info_edit_unlocked ||
      Boolean(editableDate && editableDate.getTime() <= Date.now());
    return NextResponse.json({
      bankInformation: {
        bankName: data.bank_name ?? "",
        accountNumber: data.bank_account_number ?? "",
        accountHolderName: data.bank_account_holder_name ?? "",
        addedAt: data.bank_info_added_at,
        updatedAt: data.bank_info_updated_at,
      },
      canEdit,
      editUnlocked: data.bank_info_edit_unlocked,
      editableAt,
    }, { headers: noStore });
  } catch (error) {
    console.error("Could not load user bank information.", error);
    return NextResponse.json({ error: "Could not load your bank information." }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const accountId = await getWebsiteAccountId(request);
  if (!accountId) return NextResponse.json({ error: "Sign in again before saving bank information." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your bank information." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter valid bank information." }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const bankName = readText(values.bankName);
  const accountNumber = readText(values.accountNumber);
  const accountHolderName = readText(values.accountHolderName);
  if (!bankName || bankName.length > 120 || !accountHolderName || accountHolderName.length > 120) {
    return NextResponse.json({ error: "Enter the bank name and account holder name (up to 120 characters each)." }, { status: 400 });
  }
  if (accountNumber.length < 4 || accountNumber.length > 64 || !/^[A-Za-z0-9 /-]+$/.test(accountNumber)) {
    return NextResponse.json({ error: "Enter a valid bank account number (4–64 letters, numbers, spaces, /, or -)." }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("save_website_account_bank_information", {
      p_account_id: accountId,
      p_bank_name: bankName,
      p_bank_account_number: accountNumber,
      p_bank_account_holder_name: accountHolderName,
    });
    if (error) {
      if (error.code === "P0001" && error.message === "BANK_INFORMATION_LOCKED") {
        return NextResponse.json({ error: "Your bank information is locked. Contact an administrator to request a one-time edit, or wait until the six-month lock expires." }, { status: 409, headers: noStore });
      }
      if (error.code === "P0002" && error.message === "ACCOUNT_NOT_FOUND") {
        return NextResponse.json({ error: "Account not found." }, { status: 404, headers: noStore });
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new Error("Saving bank information returned no account data.");
    return NextResponse.json({
      bankInformation: {
        bankName: saved.bank_name,
        accountNumber: saved.bank_account_number,
        accountHolderName: saved.bank_account_holder_name,
        addedAt: saved.bank_info_added_at,
        updatedAt: saved.bank_info_updated_at,
      },
      canEdit: false,
      editUnlocked: false,
      editableAt: sixMonthsAfter(saved.bank_info_updated_at).toISOString(),
    }, { headers: noStore });
  } catch (error) {
    console.error("Could not save user bank information.", error);
    return NextResponse.json({ error: "Could not save your bank information." }, { status: 503, headers: noStore });
  }
}
