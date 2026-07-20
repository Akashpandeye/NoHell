import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [createOrder, checkout, pricing] = await Promise.all([
  readFile("src/app/api/payment/create-order/route.ts", "utf8"),
  readFile("src/lib/razorpay-checkout.ts", "utf8"),
  readFile("src/lib/pricing.ts", "utf8"),
]);

assert.match(pricing, /export const PRO_PRICE_INR = 599;/, "the Pro price must be ₹599");
assert.match(pricing, /export const PRO_CURRENCY = "INR" as const;/, "the default Razorpay currency must be INR");
assert.match(pricing, /PRO_PRICE_INR \* 100/, "the Razorpay amount must be expressed in paise");
assert.match(createOrder, /parsed\s*>=\s*100/, "configured Razorpay orders must require at least 100 minor units");
assert.match(createOrder, /razorpayStatus\s*===\s*401/, "Razorpay authentication failures must return 401");
assert.match(checkout, /modal:\s*\{\s*ondismiss:/, "checkout must notify the UI when the modal is dismissed");
assert.match(checkout, /payment\.failed/, "checkout must notify the UI when Razorpay reports a failed payment");
assert.match(checkout, /Payment verification could not be completed/, "verification network errors must reach the UI");

console.log("Razorpay checkout contract passed");
