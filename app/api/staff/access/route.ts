import { NextResponse } from "next/server";

import { getStaffAccess } from "@/lib/staff-auth";

export async function GET(request: Request) {
  try {
    const staff = await getStaffAccess(request);
    if (!staff) return NextResponse.json({ error: "Active staff access is required." }, { status: 403 });
    return NextResponse.json({
      permissions: staff.permissions,
      roles: staff.roles.map((role) => role.name),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load staff permissions.", error);
    return NextResponse.json({ error: "Could not load staff permissions." }, { status: 503 });
  }
}
