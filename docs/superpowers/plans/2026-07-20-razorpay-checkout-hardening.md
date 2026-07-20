# Razorpay Checkout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing Razorpay Standard Checkout integration without exposing the key secret.

**Architecture:** Keep the existing Next.js route handlers and client helper. The create-order route enforces a valid configured order amount and translates Razorpay authentication failures. The client helper reports modal dismissals and Razorpay failures to the existing modal UI; the verify route remains the trust boundary for HMAC verification.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node crypto, Razorpay Node SDK, checkout.js.

## Global Constraints

- Use `RAZORPAY_KEY_SECRET` only in Node.js route handlers.
- Use `NEXT_PUBLIC_RAZORPAY_KEY_ID` only as the client-visible key id.
- Require configured orders to be at least 100 minor units.
- Do not add a database table or new package.

---

### Task 1: Add checkout regression contract

**Files:**
- Create: `tools/razorpay-checkout-contract.mjs`
- Modify: `package.json`

- [ ] Assert the order route rejects configured amounts below 100, and the client helper has `modal.ondismiss` plus `payment.failed` coverage.
- [ ] Run `node tools/razorpay-checkout-contract.mjs` and observe the missing-contract failure.

### Task 2: Complete backend and client behavior

**Files:**
- Modify: `src/app/api/payment/create-order/route.ts`
- Modify: `src/lib/razorpay-checkout.ts`

- [ ] Make the contract pass with the smallest route and helper changes.
- [ ] Run `npm.cmd run test:razorpay`.

### Task 3: Verify the integration

**Files:**
- Modify: `.env`
- Modify: `.env.example`

- [ ] Confirm `.env` is ignored, run the checkout contract, lint, and production build.
