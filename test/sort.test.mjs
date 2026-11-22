// Products sort by price with ?sort=price (cheapest first) and ?sort=-price (most expensive first).
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
const prices = (products) => products.map((p) => p.price);
const sorted = (list) => [...list].sort((a, b) => a - b);

// Seeded: 1 Coffee beans 12.5, 2 Tea leaves 8, 3 Mug 6.75.
// Added: 4 Kettle 30, 5 Spoon 2, 6 Bowl 8 (same price as Tea), 7 Plate 100, 8 Cup 9.5.
// 100, 30 and 9.5 would sort wrong as text ("100" < "12.5" < "2" < "30" < "6.75" < "8" < "9.5").
function priceStore() {
  const store = storeOf();
  store.add({ name: 'Kettle', price: 30, stock: 2, tags: ['kitchen', 'sale'] });
  store.add({ name: 'Spoon', price: 2, stock: 9, tags: ['kitchen'] });
  store.add({ name: 'Bowl', price: 8, stock: 0, tags: ['kitchen', 'sale'] });
  store.add({ name: 'Plate', price: 100, stock: 4, tags: ['kitchen'] });
  store.add({ name: 'Cup', price: 9.5, stock: 1, tags: ['kitchen', 'sale'] });
  return store;
}

test('sort=price returns products from cheapest to most expensive', async (t) => {
  const s = await serve(t, priceStore());
  const { status, body } = await get(s, '?sort=price');
  assert.equal(status, 200);
  assert.deepEqual(prices(body.products), [2, 6.75, 8, 8, 9.5, 12.5, 30, 100], 'numeric order, not text order');
  assert.deepEqual(ids(body.products).slice(0, 2), [5, 3]);
  assert.deepEqual(new Set(ids(body.products.slice(2, 4))), new Set([2, 6]));
  assert.deepEqual(ids(body.products).slice(4), [8, 1, 4, 7]);
  assert.equal(body.total, 8);
});

test('sort=-price returns products from most expensive to cheapest', async (t) => {
  const s = await serve(t, priceStore());
  const { status, body } = await get(s, '?sort=-price');
  assert.equal(status, 200);
  assert.deepEqual(prices(body.products), [100, 30, 12.5, 9.5, 8, 8, 6.75, 2], 'numeric order, not text order');
  assert.deepEqual(ids(body.products).slice(0, 4), [7, 4, 1, 8]);
  assert.deepEqual(new Set(ids(body.products.slice(4, 6))), new Set([2, 6]));
  assert.deepEqual(ids(body.products).slice(6), [3, 5]);
  assert.equal(body.total, 8);
});

test('the seeded catalog sorts both ways', async (t) => {
  const s = await serve(t);
  assert.deepEqual(ids((await get(s, '?sort=price')).body.products), [3, 2, 1]);
  assert.deepEqual(ids((await get(s, '?sort=-price')).body.products), [1, 2, 3]);
});

test('the sort covers the whole catalog, not just one page: limit and offset page the sorted list', async (t) => {
  const store = storeOf();
  // 47 more products whose prices are not in id order.
  for (let i = 0; i < 47; i++) store.add({ name: `Item ${i}`, price: ((i * 37) % 50) + 0.25, stock: 1 });
  const s = await serve(t, store);
  const all = (await get(s, '?limit=100')).body.products;
  assert.equal(all.length, 50);

  for (const [sort, dir] of [['price', 1], ['-price', -1]]) {
    const full = (await get(s, `?sort=${sort}&limit=100`)).body.products;
    assert.deepEqual(prices(full), sorted(prices(all)).sort((a, b) => dir * (a - b)), `sort=${sort} over the whole catalog`);

    const first = await get(s, `?sort=${sort}&limit=3`);
    assert.equal(first.body.total, 50);
    assert.deepEqual(ids(first.body.products), ids(full.slice(0, 3)), `the first page of sort=${sort} holds the extreme prices of the whole catalog`);
    assert.deepEqual(ids((await get(s, `?sort=${sort}&limit=10&offset=20`)).body.products), ids(full.slice(20, 30)));
    assert.deepEqual(ids((await get(s, `?offset=45&sort=${sort}&limit=10`)).body.products), ids(full.slice(45)));
    assert.deepEqual((await get(s, `?sort=${sort}&offset=50`)).body, { products: [], total: 50 });

    // The default page size applies to the sorted list.
    const dflt = (await get(s, `?sort=${sort}`)).body.products;
    assert.deepEqual(ids(dflt), ids(full.slice(0, dflt.length)));
  }
});

test('sorted pages are stable even with equal prices: repeated calls agree and the pages cover every product once', async (t) => {
  const store = storeOf();
  // 30 more products sharing only three prices.
  for (let i = 0; i < 30; i++) store.add({ name: `Same ${i}`, price: [5, 1, 3][i % 3], stock: 1 });
  const s = await serve(t, store);
  for (const sort of ['price', '-price']) {
    const full = ids((await get(s, `?sort=${sort}&limit=100`)).body.products);
    assert.deepEqual(ids((await get(s, `?sort=${sort}&limit=100`)).body.products), full, `sort=${sort} repeated`);
    const walked = [];
    for (let offset = 0; offset < 100; offset += 4) {
      const { body } = await get(s, `?sort=${sort}&limit=4&offset=${offset}`);
      if (!body.products.length) break;
      walked.push(...ids(body.products));
    }
    assert.equal(walked.length, 33, `sort=${sort}`);
    assert.equal(new Set(walked).size, 33, `no product shows up on two pages with sort=${sort}`);
    assert.deepEqual(walked, full, `walking the pages of sort=${sort} gives the same order as one big page`);
  }
});

test('sort works together with the tag and maxStock filters', async (t) => {
  const s = await serve(t, priceStore());
  const sale = await get(s, '?tag=sale&sort=price');
  assert.equal(sale.status, 200);
  assert.deepEqual(ids(sale.body.products), [3, 6, 8, 1, 4]);
  assert.equal(sale.body.total, 5);
  assert.deepEqual(ids((await get(s, '?sort=-price&tag=sale')).body.products), [4, 1, 8, 6, 3]);
  const low = await get(s, '?maxStock=4&sort=-price');
  assert.deepEqual(ids(low.body.products), [7, 4, 8, 6, 3]);
  assert.equal(low.body.total, 5);
  const all = await get(s, '?tag=kitchen&maxStock=4&sort=price&limit=2&offset=1');
  assert.deepEqual(ids(all.body.products), [6, 8]);
  assert.equal(all.body.total, 5);
});

test('a new product lands in its price place, and a removed one leaves it', async (t) => {
  const s = await serve(t, priceStore());
  const mid = (await s.call('POST', '/api/products', { name: 'Saucer', price: 11, stock: 3 })).body;
  const asc = ids((await get(s, '?sort=price')).body.products);
  assert.equal(asc.indexOf(mid.id), asc.indexOf(8) + 1, 'Saucer 11 comes right after Cup 9.5');
  await s.call('DELETE', '/api/products/5');
  assert.equal(ids((await get(s, '?sort=price')).body.products)[0], 3, 'Mug is the cheapest once Spoon is gone');
});

for (const q of ['?sort=name', '?sort=cost', '?sort=-cost', '?sort=stock', '?sort=price-', '?sort=--price', '?sort=asc', '?sort=price,name', '?sort=name&tag=sale&limit=2']) {
  test(`${q} answers 400 with a message naming the allowed values`, async (t) => {
    const s = await serve(t);
    const { status, body } = await get(s, q);
    assert.equal(status, 400);
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, /(^|[^-\w])price\b/, 'the message names price');
    assert.match(body.error, /-price\b/, 'the message names -price');
    assert.ok(!('products' in body), 'a refused request has no products');
  });
}

test('without sort the order stays as it is today: id order, whatever the price', async (t) => {
  const s = await serve(t, priceStore());
  const plain = await get(s);
  assert.equal(plain.status, 200);
  assert.deepEqual(ids(plain.body.products), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(plain.body.total, 8);
  assert.deepEqual(ids((await get(s, '?limit=3&offset=2')).body.products), [3, 4, 5]);
  assert.deepEqual(ids((await get(s, '?tag=sale')).body.products), [1, 3, 4, 6, 8]);
  assert.deepEqual(ids((await get(s, '?maxStock=4')).body.products), [3, 4, 6, 7, 8]);
  await s.call('PATCH', '/api/products/1', { stock: 0 });
  assert.deepEqual(ids((await get(s)).body.products), [1, 2, 3, 4, 5, 6, 7, 8], 'a stock change does not move a product');
});
