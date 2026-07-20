/** Pro plan — display and Razorpay order (INR, subunits = paise). */
export const PRO_PRICE_INR = 599;
export const PRO_CURRENCY = "INR" as const;
/** ₹599.00 in minor units (paise) for Razorpay. */
export const PRO_AMOUNT_MINOR_UNITS = PRO_PRICE_INR * 100;

export const PRO_PRICE_LABEL = `₹${PRO_PRICE_INR}/month`;
