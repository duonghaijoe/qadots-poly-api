// Coupon codes on the cart total. A cart takes up to two codes; percent codes come first, then flat ones.

export const COUPONS = {
  SAVE10: { kind: 'percent', off: 10, label: '10% off the cart' },
  TEA20: { kind: 'percent', off: 20, tag: 'tea', label: '20% off tea' },
  FLAT5: { kind: 'flat', off: 5, minTotal: 20, label: '$5 off carts of $20 or more' },
};

export const MAX_CODES = 2;

const cents = (n) => Math.round(n * 100) / 100;

/** The codes of a cart body, upper-cased, or an error why they cannot be used. */
export function codesOf(raw) {
  if (raw === undefined) return { codes: [] };
  if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'string')) return { error: 'coupons must be a list of codes' };
  const codes = raw.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length > MAX_CODES) return { error: `at most ${MAX_CODES} coupons per cart` };
  const unknown = codes.find((c) => !COUPONS[c]);
  if (unknown) return { error: `no coupon ${unknown}` };
  return { codes };
}

/** What a percent code takes off: the whole cart, or only the lines with its tag. */
function percentOff(coupon, lines) {
  const base = lines
    .filter(({ product }) => !coupon.tag || product.tags.some((t) => t.toLowerCase() === coupon.tag))
    .reduce((n, { product, qty }) => n + product.price * qty, 0);
  return (base * coupon.off) / 100;
}

/**
 * The total of the lines after the codes.
 * lines: [{ product, qty }]. Returns { subtotal, discounts: [{ code, label, amount }], total }.
 */
export function applyCoupons(lines, codes) {
  const subtotal = cents(lines.reduce((n, { product, qty }) => n + product.price * qty, 0));
  const discounts = [];
  let total = subtotal;
  const ordered = [...codes].sort((a, b) => order(COUPONS[a]) - order(COUPONS[b]));
  for (const code of ordered) {
    const coupon = COUPONS[code];
    if (coupon.kind === 'percent') {
      const amount = cents(percentOff(coupon, lines));
      if (amount <= 0) continue;
      discounts.push({ code, label: coupon.label, amount });
      total -= amount;
    } else if (coupon.kind === 'flat') {
      if (subtotal < coupon.minTotal) continue;
      discounts.push({ code, label: coupon.label, amount: coupon.off });
      total -= coupon.off;
    }
  }
  return { subtotal, discounts, total: cents(Math.max(0, total)) };
}

const order = (coupon) => (coupon.kind === 'percent' ? 0 : 1);

/** A short note for the response when a code did nothing, so the shopper knows why. */
export function skipped(lines, codes, applied) {
  const used = new Set(applied.map((d) => d.code));
  return codes
    .filter((c) => !used.has(c))
    .map((c) => {
      const coupon = COUPONS[c];
      if (coupon.kind === 'flat') return { code: c, why: `needs a cart of $${coupon.minTotal} or more` };
      if (coupon.tag) return { code: c, why: `no ${coupon.tag} in the cart` };
      return { code: c, why: 'nothing to take off' };
    });
}
