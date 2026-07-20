import { auth } from "@clerk/nextjs/server";
import Razorpay from "razorpay";
import { NextResponse } from "next/server";

import {
  PRO_AMOUNT_MINOR_UNITS,
  PRO_CURRENCY,
} from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function receiptId(userId: string): string {
  const base = `nohell_pro_${userId}`.replace(/[^a-zA-Z0-9_]/g, "_");
  return base.length <= 40 ? base : base.slice(0, 40);
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    return NextResponse.json(
      { error: "Razorpay is not configured" },
      { status: 503 },
    );
  }

  const publicKeyId =
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || keyId;

  const currency =
    process.env.RAZORPAY_ORDER_CURRENCY?.trim().toUpperCase() || PRO_CURRENCY;
  const envMinor = process.env.RAZORPAY_ORDER_AMOUNT_MINOR?.trim();
  const parsed = envMinor ? Number.parseInt(envMinor, 10) : NaN;
  const hasValidConfiguredAmount = Number.isSafeInteger(parsed) && parsed >= 100;
  if (envMinor && !hasValidConfiguredAmount) {
    return NextResponse.json(
      { error: "Razorpay order amount must be at least 100 minor units" },
      { status: 400 },
    );
  }
  const amount = hasValidConfiguredAmount ? parsed : PRO_AMOUNT_MINOR_UNITS;

  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await rzp.orders.create({
      amount,
      currency,
      receipt: receiptId(userId),
      notes: { userId: String(userId) },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: publicKeyId,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create Razorpay order";
    const razorpayStatus =
      typeof e === "object" && e && "statusCode" in e
        ? (e as { statusCode?: unknown }).statusCode
        : undefined;
    return NextResponse.json(
      { error: message },
      { status: razorpayStatus === 401 ? 401 : 500 },
    );
  }
}
