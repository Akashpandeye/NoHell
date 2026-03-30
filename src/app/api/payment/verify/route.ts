import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Body = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  userId?: string;
};

export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) {
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
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!orderId || !paymentId || !signature || !userId) {
    return NextResponse.json(
      {
        success: false,
        error: "razorpay_order_id, razorpay_payment_id, razorpay_signature, and userId are required",
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

  if (expectedSignature !== signature) {
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
