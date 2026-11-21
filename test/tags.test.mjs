// Filter the catalog by tag (duonghaijoe/qadots-poly-api#1).
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

const has = (p, tag) => p.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
const ids = (products) => products.map((p) => p.id).sort((a, b) => a - b);
const byTag = (s, tag) => s.call('GET', `/api/products?tag=${encodeURIComponent(tag)}`);

test('every seeded product has a non-empty list of string tags', async (t) => {
  const s = await serve(t);
  const { body } = await s.call('GET', '/api/products');
  assert.equal(body.products.length, 3);
  for (const p of body.products) {
    assert.ok(Array.isArray(p.tags), `${p.name} has no tags list`);
    assert.ok(p.tags.length > 0, `${p.name} has no tags`);
    for (const t of p.tags) assert.equal(typeof t, 'string');
  }
});

test('POST /api/products takes an optional tags list', async (t) => {
  const s = await serve(t);
  const tagged = await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2, tags: ['kitchen', 'sale'] });
  assert.equal(tagged.status, 201);
  assert.deepEqual(tagged.body.tags, ['kitchen', 'sale']);
  assert.deepEqual((await s.call('GET', `/api/products/${tagged.body.id}`)).body.tags, ['kitchen', 'sale']);

  const plain = await s.call('POST', '/api/products', { name: 'Spoon', price: 2, stock: 9 });
  assert.equal(plain.status, 201);
  assert.deepEqual(plain.body.tags, []);
});

test('POST /api/products refuses tags that are not a list of strings', async (t) => {
  const s = await serve(t);
  assert.equal((await s.call('POST', '/api/products', { name: 'A', price: 1, stock: 1, tags: 'sale' })).status, 400);
  assert.equal((await s.call('POST', '/api/products', { name: 'B', price: 1, stock: 1, tags: [1, 2] })).status, 400);
  assert.equal((await s.call('POST', '/api/products', { name: 'C', price: 1, stock: 1, tags: { sale: true } })).status, 400);
  const { body } = await s.call('GET', '/api/products');
  assert.equal(body.products.length, 3, 'a refused product must not be added');
});

test('?tag= returns only the products that have that tag', async (t) => {
  const s = await serve(t);
  const a = (await s.call('POST', '/api/products', { name: 'Granola', price: 5, stock: 4, tags: ['qa-organic', 'breakfast'] })).body;
  const b = (await s.call('POST', '/api/products', { name: 'Honey', price: 7, stock: 4, tags: ['qa-organic'] })).body;
  await s.call('POST', '/api/products', { name: 'Fork', price: 1, stock: 4, tags: ['kitchen'] });
  await s.call('POST', '/api/products', { name: 'Plate', price: 3, stock: 4 });

  const { status, body } = await byTag(s, 'qa-organic');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), ids([a, b]));
  for (const p of body.products) assert.ok(has(p, 'qa-organic'));
});

test('filtering by each seeded tag matches exactly the seeded products with it', async (t) => {
  const s = await serve(t);
  const all = (await s.call('GET', '/api/products')).body.products;
  const tags = new Set(all.flatMap((p) => p.tags.map((t) => t.toLowerCase())));
  assert.ok(tags.size > 0);
  for (const tag of tags) {
    const { status, body } = await byTag(s, tag);
    assert.equal(status, 200);
    assert.deepEqual(ids(body.products), ids(all.filter((p) => has(p, tag))), `tag ${tag}`);
  }
});

test('tag matching is case-insensitive both ways', async (t) => {
  const s = await serve(t);
  const up = (await s.call('POST', '/api/products', { name: 'Scarf', price: 15, stock: 1, tags: ['QA-SALE'] })).body;
  const mixed = (await s.call('POST', '/api/products', { name: 'Hat', price: 11, stock: 1, tags: ['Qa-Sale'] })).body;
  const low = (await s.call('POST', '/api/products', { name: 'Gloves', price: 9, stock: 1, tags: ['qa-sale'] })).body;
  await s.call('POST', '/api/products', { name: 'Coat', price: 90, stock: 1, tags: ['winter'] });
  const want = ids([up, mixed, low]);
  for (const q of ['qa-sale', 'QA-SALE', 'Qa-Sale', 'qA-sAlE']) {
    const { status, body } = await byTag(s, q);
    assert.equal(status, 200);
    assert.deepEqual(ids(body.products), want, `?tag=${q}`);
  }
});

test('an unknown tag returns 200 with an empty list', async (t) => {
  const s = await serve(t);
  const { status, body } = await byTag(s, 'no-such-tag-anywhere');
  assert.equal(status, 200);
  assert.deepEqual(body, { products: [] });
});

test('no tag or an empty tag returns the full list', async (t) => {
  const s = await serve(t);
  await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2, tags: ['kitchen'] });
  await s.call('POST', '/api/products', { name: 'Spoon', price: 2, stock: 9 });
  const full = await s.call('GET', '/api/products');
  assert.equal(full.status, 200);
  assert.equal(full.body.products.length, 5);
  const empty = await s.call('GET', '/api/products?tag=');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, full.body);
});

test('a tag matches whole tags only, not parts of other tags', async (t) => {
  const s = await serve(t);
  const exact = (await s.call('POST', '/api/products', { name: 'Rice', price: 4, stock: 8, tags: ['qa-bulk'] })).body;
  await s.call('POST', '/api/products', { name: 'Flour', price: 3, stock: 8, tags: ['qa-bulky'] });
  await s.call('POST', '/api/products', { name: 'Oats', price: 3, stock: 8, tags: ['xqa-bulk'] });
  assert.deepEqual(ids((await byTag(s, 'qa-bulk')).body.products), [exact.id]);
  assert.deepEqual((await byTag(s, 'qa-bul')).body.products, []);
});

test('a product without the tag never appears in a filtered response', async (t) => {
  const s = await serve(t);
  await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2, tags: ['qa-home', 'qa-sale'] });
  await s.call('POST', '/api/products', { name: 'Spoon', price: 2, stock: 9, tags: ['qa-home'] });
  await s.call('POST', '/api/products', { name: 'Bowl', price: 4, stock: 9 });
  const all = (await s.call('GET', '/api/products')).body.products;
  for (const tag of ['qa-sale', 'qa-home', 'QA-HOME', 'other']) {
    const got = (await byTag(s, tag)).body.products;
    for (const p of got) assert.ok(has(p, tag), `${p.name} has no tag ${tag}`);
    assert.deepEqual(ids(got), ids(all.filter((p) => has(p, tag))), `?tag=${tag}`);
  }
});
