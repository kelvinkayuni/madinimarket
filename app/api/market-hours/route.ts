import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";
import { getNextMarketOpening, isMarketOpenAt, MARKET_TIME_ZONE, type MarketHoursSchedule } from "@/lib/market-hours";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

function scheduleFromRow(row: {
  market_open_days: number[];
  market_open_time: string;
  market_close_time: string;
  market_hours_updated_at: string | null;
}): MarketHoursSchedule {
  return {
    openDays: row.market_open_days,
    openTime: row.market_open_time.slice(0, 5),
    closeTime: row.market_close_time.slice(0, 5),
    updatedAt: row.market_hours_updated_at,
  };
}

function responseForSchedule(schedule: MarketHoursSchedule) {
  const now = new Date();
  return {
    schedule,
    timeZone: MARKET_TIME_ZONE,
    isOpen: isMarketOpenAt(schedule, now),
    nextOpenAt: getNextMarketOpening(schedule, now),
  };
}

export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("marketplace_settings")
      .select("market_open_days, market_open_time, market_close_time, market_hours_updated_at")
      .eq("id", true)
      .single();
    if (error) throw error;
    return NextResponse.json(responseForSchedule(scheduleFromRow(data)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load the market hours schedule." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const authorized = await getAdminClient(request);
    if (!authorized) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    const { data: { user }, error: userError } = await authorized.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Admin session expired." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Enter a valid weekly market schedule." }, { status: 400 });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Enter a valid weekly market schedule." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    const openDays = values.openDays;
    const openTime = values.openTime;
    const closeTime = values.closeTime;
    if (!Array.isArray(openDays) || openDays.length < 1 || openDays.some((day) =>
      typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(openDays).size !== openDays.length ||
      typeof openTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(openTime) ||
      typeof closeTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closeTime)) {
      return NextResponse.json({ error: "Choose at least one valid day and valid 24-hour opening and closing times." }, { status: 400 });
    }

    const service = createSupabaseAdminClient();
    const { data, error } = await service.from("marketplace_settings")
      .update({
        market_open_days: [...openDays].sort((a, b) => a - b),
        market_open_time: openTime,
        market_close_time: closeTime,
        market_hours_updated_at: new Date().toISOString(),
        market_hours_updated_by: user.id,
      })
      .eq("id", true)
      .select("market_open_days, market_open_time, market_close_time, market_hours_updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json(responseForSchedule(scheduleFromRow(data)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not update the market hours schedule." }, { status: 503 });
  }
}
