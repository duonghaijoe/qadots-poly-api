// Products search by name with ?q= (the name has q in it, any case).
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

const get = (s, query = '') => s.call('GET', `/api/products${query}`);
const ids = (products) => products.map((p) => p.id);
const add = async (s, product) => {
  const res = await s.call('POST', '/api/products', product);
  assert.equal(res.status, 201, `adding ${product.name}`);
  return res.body;
};

// Seeded: 1 Coffee beans, 2 Tea leaves, 3 Mug (kitchen, sale).
// Added: 4 Travel MUG, 5 Smuggler's bag, 6 mug rack, 7 Cup (tagged mug, category mug), 8 Teapot.
async function catalog(s) {
  return {
    travel: await add(s, { name: 'Travel MUG', price: 15, stock: 4, tags: ['sale'], category: 'kitchen' }),
    bag: await add(s, { name: "Smuggler's bag", price: 40, stock: 1 }),
    rack: await add(s, { name: 'mug rack', price: 9, stock: 0, tags: ['kitchen'], category: 'kitchen' }),
    cup: await add(s, { name: 'Cup', price: 4, stock: 10, tags: ['mug'], category: 'mug' }),
    teapot: await add(s, { name: 'Teapot', price: 22, stock: 2, tags: ['tea'] }),
  };
}

test('?q=mug lists the products whose name has mug in it, any case', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const { status, body } = await get(s, '?q=mug');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [3, c.travel.id, c.bag.id, c.rack.id], 'Mug, Travel MUG, Smuggler\'s bag, mug rack');
  for (const p of body.products) assert.match(p.name, /mug/i);
  assert.equal(body.total, 4);
});

test('the case of q does not matter either', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const want = [3, c.travel.id, c.bag.id, c.rack.id];
  for (const q of ['mug', 'MUG', 'Mug', 'mUg']) {
    const { status, body } = await get(s, `?q=${q}`);
    assert.equal(status, 200, q);
    assert.deepEqual(ids(body.products), want, `?q=${q}`);
  }
});

test('q matches any part of the name, spaces and punctuation included', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  assert.deepEqual(ids((await get(s, '?q=tea')).body.products), [2, c.teapot.id]);
  assert.deepEqual(ids((await get(s, '?q=el%20m')).body.products), [c.travel.id], 'q with a space');
  assert.deepEqual(ids((await get(s, `?q=${encodeURIComponent("r's b")}`)).body.products), [c.bag.id], 'q with an apostrophe');
  assert.deepEqual(ids((await get(s, '?q=Coffee%20beans')).body.products), [1], 'the whole name');
  assert.deepEqual(ids((await get(s, '?q=s')).body.products), [1, 2, c.bag.id], 'a single letter');
});

test('q searches the name only, not tags or category', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  assert.ok(!ids((await get(s, '?q=mug')).body.products).includes(c.cup.id), 'Cup is tagged mug and in category mug, but its name has no mug');
  assert.deepEqual((await get(s, '?q=organic')).body, { products: [], total: 0 }, 'organic is only a tag');
  assert.deepEqual((await get(s, '?q=kitchen')).body, { products: [], total: 0 }, 'kitchen is only a tag and a category');
});

test('an empty q lists every product', async (t) => {
  const s = await serve(t);
  await catalog(s);
  const plain = await get(s);
  assert.equal(plain.body.total, 8);
  const empty = await get(s, '?q=');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, plain.body);
  assert.deepEqual((await get(s, '?q=&limit=3&offset=2')).body, (await get(s, '?limit=3&offset=2')).body);
});

test('no match lists nothing with total 0', async (t) => {
  const s = await serve(t);
  await catalog(s);
  for (const q of ['zebra', 'mugs', 'mug%20%20rack', 'cupboard', 'xyz&limit=5&offset=0']) {
    const { status, body } = await get(s, `?q=${q}`);
    assert.equal(status, 200, q);
    assert.deepEqual(body, { products: [], total: 0 }, `?q=${q}`);
  }
});

test('q is plain text, not a pattern', async (t) => {
  const s = await serve(t);
  await catalog(s);
  for (const q of ['.', '.*', '(', '[', '\\', '*', '?', '+', '^M', 'g$', 'm.g', '%25']) {
    const { status, body } = await get(s, `?q=${encodeURIComponent(q)}`);
    assert.equal(status, 200, `?q=${q}`);
    assert.deepEqual(body, { products: [], total: 0 }, `?q=${q} has no product with that text in its name`);
  }
  const dotted = await add(s, { name: 'Mug v2.0 (large)', price: 9, stock: 3 });
  for (const q of ['.', '2.0', '(large)', 'v2.0 (']) assert.deepEqual(ids((await get(s, `?q=${encodeURIComponent(q)}`)).body.products), [dotted.id], `?q=${q}`);
});

test('the total counts the matches, not the catalog or the page', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const page = await get(s, '?q=mug&limit=2');
  assert.deepEqual(ids(page.body.products), [3, c.travel.id]);
  assert.equal(page.body.total, 4);
  const next = await get(s, '?q=mug&limit=2&offset=2');
  assert.deepEqual(ids(next.body.products), [c.bag.id, c.rack.id]);
  assert.equal(next.body.total, 4);
  assert.deepEqual((await get(s, '?q=mug&offset=4')).body, { products: [], total: 4 });

  await add(s, { name: 'Mugwort tea', price: 6, stock: 8 });
  assert.equal((await get(s, '?q=mug')).body.total, 5, 'a new match counts');
  await s.call('DELETE', `/api/products/${c.bag.id}`);
  assert.equal((await get(s, '?q=mug')).body.total, 4, 'a deleted match no longer counts');
});

test('q combines with the other filters and the sort', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  assert.deepEqual(ids((await get(s, '?q=mug&tag=sale')).body.products), [3, c.travel.id]);
  assert.deepEqual(ids((await get(s, '?q=mug&category=kitchen')).body.products), [c.travel.id, c.rack.id]);
  assert.deepEqual(ids((await get(s, '?q=mug&maxStock=1')).body.products), [c.bag.id, c.rack.id]);
  const sorted = await get(s, '?q=mug&sort=-price');
  assert.deepEqual(ids(sorted.body.products), [c.bag.id, c.travel.id, c.rack.id, 3]);
  assert.equal(sorted.body.total, 4);
});

test('without q the list is unchanged', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const { status, body } = await get(s);
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [1, 2, 3, ...ids(Object.values(c))]);
  assert.equal(body.total, 8);
});
