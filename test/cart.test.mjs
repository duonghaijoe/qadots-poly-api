// Block cart totals above available stock (duonghaijoe/qadots-poly-api#5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appFor } from '../src/app.mjs';

async function serve(t) {
  const server = createServer(appFor({ sha: 'abc', env: 'test' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { call };
}

// Seeded: 1 Coffee beans 12.5 x40, 2 Tea leaves 8 x25, 3 Mug 6.75 x3.
const total = (s, items) => s.call('POST', '/api/cart/total', { items });

test('a cart with one short line gets no total, even when the other lines are in stock', async (t) => {
  const s = await serve(t);
  const { status, body } = await total(s, [{ id: 1, qty: 2 }, { id: 3, qty: 4 }]);
  assert.equal(status, 409);
  assert.ok(!('total' in body));
});

test('a line over stock answers 409 with an error and no total', async (t) => {
  const s = await serve(t);
  const { status, body } = await total(s, [{ id: 3, qty: 4 }]);
  assert.equal(status, 409);
  assert.equal(typeof body.error, 'string');
  assert.ok(!('total' in body));
});

test('the error names the short product by id and name, with requested and in-stock quantities', async (t) => {
  const s = await serve(t);
  const { body } = await total(s, [{ id: 3, qty: 5 }]);
  assert.deepEqual(body, { error: 'only 3 of Mug left', short: [{ id: 3, name: 'Mug', requested: 5, inStock: 3 }] });
});

test('every short product is listed in one response, and only the short ones', async (t) => {
  const s = await serve(t);
  const { status, body } = await total(s, [{ id: 1, qty: 41 }, { id: 2, qty: 1 }, { id: 3, qty: 9 }]);
  assert.equal(status, 409);
  assert.deepEqual(body.short, [
    { id: 1, name: 'Coffee beans', requested: 41, inStock: 40 },
    { id: 3, name: 'Mug', requested: 9, inStock: 3 },
  ]);
  assert.match(body.error, /Coffee beans/);
  assert.match(body.error, /Mug/);
});

test('requested is summed across lines of the same product', async (t) => {
  const s = await serve(t);
  const { status, body } = await total(s, [{ id: 3, qty: 2 }, { id: 2, qty: 1 }, { id: 3, qty: 2 }]);
  assert.equal(status, 409);
  assert.deepEqual(body.short, [{ id: 3, name: 'Mug', requested: 4, inStock: 3 }]);
});

test('a line with quantity equal to stock is accepted', async (t) => {
  const s = await serve(t);
  assert.deepEqual(await total(s, [{ id: 3, qty: 3 }]), { status: 200, body: { total: 20.25 } });
  assert.deepEqual(await total(s, [{ id: 3, qty: 1 }, { id: 3, qty: 2 }]), { status: 200, body: { total: 20.25 } });
});

test('a cart where every line is in stock returns the same total as before', async (t) => {
  const s = await serve(t);
  assert.deepEqual(await total(s, [{ id: 1, qty: 2 }, { id: 3, qty: 1 }]), { status: 200, body: { total: 31.75 } });
  assert.deepEqual(await total(s, [{ id: 1, qty: 1 }, { id: 2, qty: 3 }, { id: 3, qty: 2 }]), { status: 200, body: { total: 50 } });
});

test('a product with zero stock counts as short', async (t) => {
  const s = await serve(t);
  assert.equal((await s.call('PATCH', '/api/products/2', { stock: 0 })).status, 200);
  const { status, body } = await total(s, [{ id: 2, qty: 1 }]);
  assert.equal(status, 409);
  assert.deepEqual(body.short, [{ id: 2, name: 'Tea leaves', requested: 1, inStock: 0 }]);
  assert.ok(!('total' in body));
});
