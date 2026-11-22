// Coupon codes on the cart total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appFor } from '../src/app.mjs';

async function serve(t) {
  const server = createServer(appFor({ sha: 'abc', env: 'test' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return async (items, coupons) => {
    const res = await fetch(`${base}/api/cart/total`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, coupons }) });
    return { status: res.status, body: await res.json() };
  };
}

// Seeded: 1 Coffee beans 12.5 x40, 2 Tea leaves 8 x25, 3 Mug 6.75 x3.

test('a cart without coupons keeps the plain total', async (t) => {
  const total = await serve(t);
  assert.deepEqual((await total([{ id: 1, qty: 2 }])).body, { total: 25 });
});

test('SAVE10 takes 10% off the cart', async (t) => {
  const total = await serve(t);
  const { status, body } = await total([{ id: 1, qty: 2 }], ['save10']);
  assert.equal(status, 200);
  assert.equal(body.subtotal, 25);
  assert.equal(body.total, 22.5);
  assert.deepEqual(body.discounts, [{ code: 'SAVE10', label: '10% off the cart', amount: 2.5 }]);
});

test('TEA20 only takes off the tea lines', async (t) => {
  const total = await serve(t);
  const { body } = await total([{ id: 1, qty: 1 }, { id: 2, qty: 2 }], ['TEA20']);
  assert.equal(body.total, 25.3);
});

test('FLAT5 needs a cart of $20 or more', async (t) => {
  const total = await serve(t);
  assert.equal((await total([{ id: 2, qty: 2 }], ['FLAT5'])).body.total, 16);
  assert.deepEqual((await total([{ id: 2, qty: 2 }], ['FLAT5'])).body.skipped, [{ code: 'FLAT5', why: 'needs a cart of $20 or more' }]);
  assert.equal((await total([{ id: 1, qty: 2 }], ['FLAT5'])).body.total, 20);
});

test('percent codes come before flat ones', async (t) => {
  const total = await serve(t);
  const { body } = await total([{ id: 1, qty: 4 }], ['FLAT5', 'SAVE10']);
  assert.equal(body.total, 40);
});

test('unknown codes and more than two codes are refused', async (t) => {
  const total = await serve(t);
  assert.deepEqual(await total([{ id: 1, qty: 1 }], ['NOPE']), { status: 400, body: { error: 'no coupon NOPE' } });
  assert.equal((await total([{ id: 1, qty: 1 }], ['SAVE10', 'TEA20', 'FLAT5'])).status, 400);
});
