/** Pro plan — display and Razorpay order (USD, subunits = cents). */
export const PRO_PRICE_USD = 9;
export const PRO_CURRENCY = "USD" as const;
/** $9.00 in minor units (cents) for Razorpay. */
export const PRO_AMOUNT_MINOR_UNITS = PRO_PRICE_USD * 100;

export const PRO_PRICE_LABEL = `$${PRO_PRICE_USD}/month`;
