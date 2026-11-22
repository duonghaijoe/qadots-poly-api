// The catalog filters low stock products with ?maxStock= (stock at most that many).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appFor, storeOf } from '../src/app.mjs';

async function serve(t, store = storeOf()) {
  const server = createServer(appFor({ sha: 'abc', env: 'test' }, store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { call };
}

const get = (s, query = '') => s.call('GET', `/api/products${query}`);
const ids = (products) => products.map((p) => p.id);

// Seeded: 1 Coffee beans x40, 2 Tea leaves x25, 3 Mug x3 (kitchen, sale).
// Added: 4 Kettle x0 (kitchen, sale), 5 Spoon x5 (kitchen), 6 Bowl x6 (kitchen, sale), 7 Fork x1, 8 Plate x0 (kitchen).
function lowStore() {
  const store = storeOf();
  store.add({ name: 'Kettle', price: 30, stock: 0, tags: ['kitchen', 'sale'] });
  store.add({ name: 'Spoon', price: 2, stock: 5, tags: ['kitchen'] });
  store.add({ name: 'Bowl', price: 4, stock: 6, tags: ['kitchen', 'sale'] });
  store.add({ name: 'Fork', price: 1, stock: 1 });
  store.add({ name: 'Plate', price: 3, stock: 0, tags: ['kitchen'] });
  return store;
}

test('maxStock=5 returns only products with stock at most 5, and total counts them', async (t) => {
  const s = await serve(t, lowStore());
  const { status, body } = await get(s, '?maxStock=5');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [3, 4, 5, 7, 8], 'stock 5 is included, stock 6 and above are not');
  for (const p of body.products) assert.ok(p.stock <= 5, `${p.name} has stock ${p.stock}`);
  assert.equal(body.total, 5);
});

test('maxStock is inclusive at every threshold', async (t) => {
  const s = await serve(t, lowStore());
  for (const [max, want] of [[1, [4, 7, 8]], [3, [3, 4, 7, 8]], [6, [3, 4, 5, 6, 7, 8]], [25, [2, 3, 4, 5, 6, 7, 8]], [40, [1, 2, 3, 4, 5, 6, 7, 8]], [1000000, [1, 2, 3, 4, 5, 6, 7, 8]]]) {
    const { status, body } = await get(s, `?maxStock=${max}`);
    assert.equal(status, 200, `maxStock=${max}`);
    assert.deepEqual(ids(body.products), want, `maxStock=${max}`);
    assert.equal(body.total, want.length, `total for maxStock=${max}`);
  }
});

test('maxStock=0 returns the sold out products', async (t) => {
  const s = await serve(t, lowStore());
  const { status, body } = await get(s, '?maxStock=0');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [4, 8]);
  for (const p of body.products) assert.equal(p.stock, 0);
  assert.equal(body.total, 2);
});

test('maxStock=0 with nothing sold out returns an empty list and total 0', async (t) => {
  const s = await serve(t);
  const { status, body } = await get(s, '?maxStock=0');
  assert.equal(status, 200);
  assert.deepEqual(body, { products: [], total: 0 });
});

test('the filter follows stock changes', async (t) => {
  const s = await serve(t, lowStore());
  await s.call('PATCH', '/api/products/2', { stock: 2 });
  await s.call('PATCH', '/api/products/3', { delta: 10 });
  await s.call('PATCH', '/api/products/7', { delta: -1 });
  assert.deepEqual(ids((await get(s, '?maxStock=5')).body.products), [2, 4, 5, 7, 8]);
  assert.deepEqual(ids((await get(s, '?maxStock=0')).body.products), [4, 7, 8]);
});

for (const q of [
  '?maxStock=-1', '?maxStock=abc', '?maxStock=1.5', '?maxStock=5abc', '?maxStock=1e1', '?maxStock=0x5', '?maxStock=%205', '?maxStock=-0.5',
  '?maxStock=five&tag=sale', '?limit=5&offset=0&maxStock=-3',
]) {
  test(`${q} answers 400 with an error and no products`, async (t) => {
    const s = await serve(t, lowStore());
    const { status, body } = await get(s, q);
    assert.equal(status, 400);
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.trim().length > 0, 'the error says what is wrong');
    assert.ok(!('products' in body), 'a refused request has no products');
  });
}

test('maxStock works together with tag', async (t) => {
  const s = await serve(t, lowStore());
  const sale = await get(s, '?tag=sale&maxStock=5');
  assert.equal(sale.status, 200);
  assert.deepEqual(ids(sale.body.products), [3, 4], 'tagged sale and stock at most 5');
  assert.equal(sale.body.total, 2);
  assert.deepEqual(ids((await get(s, '?maxStock=0&tag=KITCHEN')).body.products), [4, 8]);
  assert.deepEqual((await get(s, '?tag=tea&maxStock=5')).body, { products: [], total: 0 });
  assert.deepEqual(ids((await get(s, '?tag=&maxStock=1')).body.products), [4, 7, 8], 'an empty tag does not filter');
});

test('maxStock works together with limit and offset: pages and total count only the filtered products', async (t) => {
  const store = storeOf();
  // 60 more products, ids 4..63; stock cycles 0..9, so ids with (id - 4) % 10 <= 5 have stock at most 5.
  for (let i = 0; i < 60; i++) store.add({ name: `Item ${i}`, price: 1, stock: i % 10, tags: i % 2 ? ['odd'] : ['even'] });
  const s = await serve(t, store);
  const all = (await get(s, '?limit=100')).body.products;
  const low = all.filter((p) => p.stock <= 5);
  assert.equal(low.length, 37, 'Mug plus 36 items');

  const page = await get(s, '?maxStock=5&limit=10&offset=10');
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 37);
  assert.deepEqual(ids(page.body.products), ids(low.slice(10, 20)));

  assert.deepEqual(ids((await get(s, '?offset=30&maxStock=5&limit=10')).body.products), ids(low.slice(30)), 'the last page is short');
  const past = await get(s, '?maxStock=5&offset=37');
  assert.equal(past.status, 200);
  assert.deepEqual(past.body, { products: [], total: 37 });

  // Walking the pages gives exactly the low stock products, in order.
  const walked = [];
  for (let offset = 0; offset < 100; offset += 7) {
    const { body } = await get(s, `?maxStock=5&limit=7&offset=${offset}`);
    if (!body.products.length) break;
    walked.push(...ids(body.products));
  }
  assert.deepEqual(walked, ids(low));

  // The default page size still applies with maxStock alone.
  const first = await get(s, '?maxStock=5');
  assert.equal(first.body.total, 37);
  assert.deepEqual(ids(first.body.products), ids(low.slice(0, first.body.products.length)));
  assert.ok(first.body.products.length >= 5 && first.body.products.length < 37);

  // All three together with tag.
  const evenLow = low.filter((p) => p.tags.includes('even'));
  const mixed = await get(s, '?tag=even&maxStock=5&limit=5&offset=5');
  assert.equal(mixed.body.total, evenLow.length);
  assert.deepEqual(ids(mixed.body.products), ids(evenLow.slice(5, 10)));
});

test('paging errors still win when maxStock is valid', async (t) => {
  const s = await serve(t, lowStore());
  for (const q of ['?maxStock=5&limit=0', '?maxStock=5&offset=-1', '?maxStock=5&limit=abc']) {
    const { status, body } = await get(s, q);
    assert.equal(status, 400, q);
    assert.equal(typeof body.error, 'string', q);
  }
});

test('without maxStock the list is unchanged', async (t) => {
  const s = await serve(t, lowStore());
  const plain = await get(s);
  assert.equal(plain.status, 200);
  assert.deepEqual(ids(plain.body.products), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plain.body.total, 8);
  assert.deepEqual(ids((await get(s, '?tag=sale')).body.products), [1, 3, 4, 6]);
  assert.deepEqual(ids((await get(s, '?limit=3&offset=2')).body.products), [3, 4, 5]);
  assert.equal((await get(s, '?limit=3&offset=2')).body.total, 8);
  const other = await get(s, '?minStock=5&max=1');
  assert.equal(other.status, 200, 'other unknown params are ignored as before');
  assert.deepEqual(other.body, plain.body);
});
