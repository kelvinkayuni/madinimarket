import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { verifyGmailConnection } from "@/lib/gmail";

export async function POST(request: Request) {
  try {
    const admin = await getAdminClient(request);
    if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const sender = await verifyGmailConnection();
    return NextResponse.json({ connected: true, sender }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { connected: false, error: "Gmail connection failed. Check the server environment variables and app password." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}