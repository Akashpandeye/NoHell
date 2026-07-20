export type CreateOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => {
      on: (
        event: "payment.failed",
        listener: (response: { error?: { description?: string } }) => void,
      ) => void;
      open: () => void;
    };
  }
}

function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(script);
  });
}

export type RazorpayCheckoutParams = {
  email: string | undefined;
  onSuccess: () => void;
  onFailure?: (message: string) => void;
};

/**
 * Creates an order, loads checkout.js, and opens Razorpay modal.
 */
export async function openRazorpayCheckout(
  params: RazorpayCheckoutParams,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/payment/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch {
    params.onFailure?.("Could not start checkout");
    return;
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    params.onFailure?.(err.error ?? "Could not start checkout");
    return;
  }

  const order = (await res.json()) as CreateOrderResponse;

  try {
    await loadRazorpayScript();
  } catch {
    params.onFailure?.("Could not load Razorpay checkout");
    return;
  }

  const Rzp = window.Razorpay;
  if (!Rzp) {
    params.onFailure?.("Razorpay is unavailable");
    return;
  }

  const options: Record<string, unknown> = {
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    order_id: order.orderId,
    name: "NoHell",
    description: "Pro Plan — Unlimited Sessions",
    prefill: { email: params.email ?? "" },
    theme: { color: "#f0a500" },
    handler: async function handler(response: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }) {
      try {
        const verify = await fetch("/api/payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        const data = (await verify.json()) as { success?: boolean };
        if (data.success) {
          params.onSuccess();
        } else {
          params.onFailure?.("Payment verification failed");
        }
      } catch {
        params.onFailure?.("Payment verification could not be completed");
      }
    },
    modal: {
      ondismiss: () => params.onFailure?.("Payment cancelled"),
    },
  };

  const instance = new Rzp(options);
  instance.on("payment.failed", (response) => {
    params.onFailure?.(response.error?.description ?? "Payment failed");
  });
  instance.open();
}
