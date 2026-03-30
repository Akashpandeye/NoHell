import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PaymentCapturedPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        notes?: Record<string, string>;
      };
    };
  };
};

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "RAZORPAY_WEBHOOK_SECRET is not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing X-Razorpay-Signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (expected !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let parsed: PaymentCapturedPayload;
  try {
    parsed = JSON.parse(rawBody) as PaymentCapturedPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (parsed.event === "payment.captured") {
    const notes = parsed.payload?.payment?.entity?.notes;
    const userId = notes?.userId ?? notes?.user_id;
    if (typeof userId === "string" && userId.trim()) {
      try {
        const { serverUpgradeToPro } = await import("@/lib/server-firestore");
        await serverUpgradeToPro(userId.trim());
      } catch {
        /* still return 200 so Razorpay does not retry indefinitely; log server-side in production */
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
