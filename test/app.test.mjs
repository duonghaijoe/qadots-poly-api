import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appFor } from '../src/app.mjs';

async function serve() {
  const server = createServer(appFor({ sha: 'abc', env: 'test' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { call, close: () => server.close() };
}

test('lists the seeded products', async () => {
  const s = await serve();
  const { status, body } = await s.call('GET', '/api/products');
  assert.equal(status, 200);
  assert.equal(body.products.length, 3);
  s.close();
});

test('adds a product and refuses a bad one', async () => {
  const s = await serve();
  assert.equal((await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2 })).status, 201);
  assert.equal((await s.call('POST', '/api/products', { name: '', price: 30, stock: 2 })).status, 400);
  assert.equal((await s.call('POST', '/api/products', { name: 'X', price: 0, stock: 2 })).status, 400);
  s.close();
});

test('totals a cart and refuses more than the stock', async () => {
  const s = await serve();
  assert.deepEqual((await s.call('POST', '/api/cart/total', { items: [{ id: 1, qty: 2 }, { id: 3, qty: 1 }] })).body, { total: 31.75 });
  assert.equal((await s.call('POST', '/api/cart/total', { items: [{ id: 3, qty: 4 }] })).status, 409);
  s.close();
});

test('adds up qty of the same product across cart lines before checking stock (#6)', async () => {
  const s = await serve();
  try {
    const split = await s.call('POST', '/api/cart/total', { items: [{ id: 3, qty: 2 }, { id: 3, qty: 2 }] });
    assert.equal(split.status, 409);
    assert.deepEqual(split.body, { error: 'only 3 of Mug left' });
    assert.deepEqual((await s.call('POST', '/api/cart/total', { items: [{ id: 3, qty: 1 }, { id: 1, qty: 1 }, { id: 3, qty: 2 }] })).body, { total: 32.75 });
  } finally {
    s.close();
  }
});
