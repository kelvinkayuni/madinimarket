import { NextResponse } from "next/server";

import { getAdminClient } from "@/lib/admin-auth";

type Currency = "TZS" | "USD";
type PeriodTotals = Record<Currency, {
  transactions: number;
  grossSales: number;
  sellerAmount: number;
  marketplaceFee: number;
}>;
type HistoryKey = "daily" | "weekly" | "monthly" | "yearly";

const TIME_ZONE = "Africa/Dar_es_Salaam";
const PAGE_SIZE = 500;
const INCLUDED_ITEM_STATUSES = [
  "paid", "shipped", "delivered", "disputed", "payout_due", "payout_paid", "refund_due",
];

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const { year, month, day } = values;
  if (!year || !month || !day) throw new Error("Could not format the marketplace accounting date.");
  return { year, month, day };
}

function periodKeys(date: Date) {
  const { year, month, day } = dateParts(date);
  const localDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  const weekStart = [
    localDate.getUTCFullYear(),
    String(localDate.getUTCMonth() + 1).padStart(2, "0"),
    String(localDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return {
    day: `${year}-${month}-${day}`,
    week: weekStart,
    month: `${year}-${month}`,
    year,
  };
}

function emptyTotals(): PeriodTotals {
  return {
    TZS: { transactions: 0, grossSales: 0, sellerAmount: 0, marketplaceFee: 0 },
    USD: { transactions: 0, grossSales: 0, sellerAmount: 0, marketplaceFee: 0 },
  };
}

export async function GET(request: Request) {
  const admin = await getAdminClient(request);
  if (!admin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const orders = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin.from("marketplace_orders")
        .select("id, control_number, payment_verified_at, items:marketplace_order_items(id, mineral_name, status, total_price, seller_amount, platform_fee_rate, platform_fee_amount, currency)")
        .eq("payment_status", "paid")
        .not("payment_verified_at", "is", null)
        .order("payment_verified_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      orders.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const periods = {
      today: emptyTotals(),
      thisWeek: emptyTotals(),
      thisMonth: emptyTotals(),
      thisYear: emptyTotals(),
    };
    const historyGroups: Record<HistoryKey, Map<string, PeriodTotals>> = {
      daily: new Map(),
      weekly: new Map(),
      monthly: new Map(),
      yearly: new Map(),
    };
    const transactions = [];
    const current = periodKeys(new Date());
    for (const order of orders) {
      if (!order.payment_verified_at) continue;
      const keys = periodKeys(new Date(order.payment_verified_at));
      const buckets = [
        ...(keys.day === current.day ? [periods.today] : []),
        ...(keys.week === current.week ? [periods.thisWeek] : []),
        ...(keys.month === current.month ? [periods.thisMonth] : []),
        ...(keys.year === current.year ? [periods.thisYear] : []),
      ];
      for (const item of order.items ?? []) {
        if (!INCLUDED_ITEM_STATUSES.includes(item.status)) continue;
        const currency = item.currency as Currency;
        if (currency !== "TZS" && currency !== "USD") continue;
        const grossSales = Number(item.total_price);
        const sellerAmount = Number(item.seller_amount);
        const marketplaceFee = Number(item.platform_fee_amount);
        if (![grossSales, sellerAmount, marketplaceFee].every(Number.isFinite)) {
          throw new Error(`Invalid financial values on marketplace order ${order.control_number}.`);
        }
        transactions.push({
          itemId: item.id,
          orderId: order.id,
          controlNumber: order.control_number,
          verifiedAt: order.payment_verified_at,
          mineralName: item.mineral_name,
          status: item.status,
          currency,
          grossSales,
          sellerAmount,
          marketplaceFee,
          feeRate: Number(item.platform_fee_rate),
        });
        for (const bucket of buckets) {
          bucket[currency].transactions += 1;
          bucket[currency].grossSales += grossSales;
          bucket[currency].sellerAmount += sellerAmount;
          bucket[currency].marketplaceFee += marketplaceFee;
        }
        const historyKeys: [HistoryKey, string][] = [
          ["daily", keys.day],
          ["weekly", keys.week],
          ["monthly", keys.month],
          ["yearly", keys.year],
        ];
        for (const [period, key] of historyKeys) {
          let totals = historyGroups[period].get(key);
          if (!totals) {
            totals = emptyTotals();
            historyGroups[period].set(key, totals);
          }
          totals[currency].transactions += 1;
          totals[currency].grossSales += grossSales;
          totals[currency].sellerAmount += sellerAmount;
          totals[currency].marketplaceFee += marketplaceFee;
        }
      }
    }

    return NextResponse.json({
      periods,
      history: Object.fromEntries(Object.entries(historyGroups).map(([period, values]) => [
        period,
        [...values.entries()]
          .sort(([first], [second]) => second.localeCompare(first))
          .map(([key, totals]) => ({ period: key, totals })),
      ])),
      transactions: transactions.sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt)),
      timeZone: TIME_ZONE,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Admin could not load marketplace sales ledger", error);
    return NextResponse.json({ error: "Could not load the marketplace sales ledger." }, { status: 503 });
  }
}
