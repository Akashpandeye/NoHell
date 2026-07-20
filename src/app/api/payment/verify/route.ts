import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import Razorpay from "razorpay";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized", status: 401 }, { status: 401 });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  if (!secret || !keyId) {
    return NextResponse.json(
      { success: false, error: "Razorpay is not configured", status: 503 },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body", status: 400 },
      { status: 400 },
    );
  }

  const orderId = body.razorpay_order_id?.trim() ?? "";
  const paymentId = body.razorpay_payment_id?.trim() ?? "";
  const signature = body.razorpay_signature?.trim() ?? "";

  if (!orderId || !paymentId || !signature) {
    return NextResponse.json(
      {
        success: false,
        error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required",
        status: 400,
      },
      { status: 400 },
    );
  }

  const payload = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return NextResponse.json(
      {
        success: false,
        error: "Payment verification failed",
        status: 400,
      },
      { status: 400 },
    );
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: secret });
    const order = await razorpay.orders.fetch(orderId);
    const orderUserId = typeof order.notes?.userId === "string" ? order.notes.userId : "";
    if (orderUserId !== userId) {
      return NextResponse.json({ success: false, error: "Payment order not found", status: 404 }, { status: 404 });
    }

    const { serverUpgradeToPro } = await import("@/lib/server-firestore");
    await serverUpgradeToPro(userId);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to upgrade account";
    return NextResponse.json(
      { success: false, error: message, status: 500 },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
