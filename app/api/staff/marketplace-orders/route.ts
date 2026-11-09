import { NextResponse } from "next/server";

import { getStaffAccess } from "@/lib/staff-auth";
import { ownsStaffTaskClaim } from "@/lib/staff-task-claims";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  let staff: Awaited<ReturnType<typeof getStaffAccess>>;
  try {
    staff = await getStaffAccess(request, "delivery_confirmation");
  } catch (error) {
    console.error("Could not verify order operations staff access.", error);
    return NextResponse.json({ error: "Could not verify staff access." }, { status: 503 });
  }
  if (!staff) return NextResponse.json({ error: "Active order operations staff access is required." }, { status: 403 });

  const page = Number(new URL(request.url).searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 40_000) {
    return NextResponse.json({ error: "Choose a valid order page." }, { status: 400 });
  }
  const { data: queue, error: queueError } = await staff.admin.rpc("admin_marketplace_order_queue", {
    p_filter: "delivery_due",
    p_search: "",
    p_offset: (page - 1) * 25,
    p_limit: 25,
  });
  if (queueError) {
    console.error("Order operations staff could not load delivery tasks.", queueError);
    return NextResponse.json({ error: "Could not load delivery tasks. Apply the marketplace admin order queue migration." }, { status: 503 });
  }

  const rows = queue as { order_id: string | null; total_count: number | string }[] | null;
  const totalCount = Number(rows?.[0]?.total_count ?? 0);
  const orderIds = (rows ?? []).map((row) => row.order_id).filter((id): id is string => Boolean(id));
  if (!orderIds.length) return NextResponse.json({ orders: [], totalCount, page, pageSize: 25 });

  const { data: orders, error: ordersError } = await staff.admin.from("marketplace_orders")
    .select("id, control_number, created_at, items:marketplace_order_items(id, seller_id, mineral_name, weight, unit, status, shipping_carrier, tracking_number)")
    .in("id", orderIds);
  if (ordersError) {
    console.error("Order operations staff could not load delivery task details.", ordersError);
    return NextResponse.json({ error: "Could not load delivery task details." }, { status: 503 });
  }
  const ordersById = new Map((orders ?? []).map((order) => [order.id, order]));
  return NextResponse.json({
    orders: orderIds.flatMap((id) => {
      const order = ordersById.get(id);
      if (!order) return [];
      return [{
        id: order.id,
        control_number: order.control_number,
        created_at: order.created_at,
        items: (order.items ?? []).filter((item) =>
          ["paid", "shipped"].includes(item.status) &&
          Boolean(item.shipping_carrier?.trim()) &&
          Boolean(item.tracking_number?.trim()),
        ),
      }];
    }),
    totalCount,
    page,
    pageSize: 25,
  });
}

export async function PATCH(request: Request) {
  let staff: Awaited<ReturnType<typeof getStaffAccess>>;
  try {
    staff = await getStaffAccess(request, "delivery_confirmation");
  } catch (error) {
    console.error("Could not verify order operations staff access.", error);
    return NextResponse.json({ error: "Could not verify staff access." }, { status: 503 });
  }
  if (!staff) return NextResponse.json({ error: "Active order operations staff access is required." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const itemId = (body as Record<string, unknown>).itemId;
  if (typeof itemId !== "string" || !uuidPattern.test(itemId)) {
    return NextResponse.json({ error: "Choose a valid shipment." }, { status: 400 });
  }

  try {
    if (!await ownsStaffTaskClaim(staff.admin, staff.staffId, "marketplace_order_item", itemId)) {
      return NextResponse.json({ error: "Claim this shipment before confirming delivery. Another staff member may already be handling it." }, { status: 409 });
    }
  } catch (error) {
    console.error("Could not verify the order operations staff task claim.", error);
    return NextResponse.json({ error: "Could not verify task ownership." }, { status: 503 });
  }

  const { data, error } = await staff.admin.rpc("staff_confirm_marketplace_order_delivery", {
    p_staff_user_id: staff.userId,
    p_order_item_id: itemId,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Active order operations staff access is required." }, { status: 403 });
    if (error.code === "P0002" || error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Order operations staff could not confirm shipment delivery.", error);
    return NextResponse.json({ error: "Could not confirm shipment delivery." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, itemsUpdated: data });
}
