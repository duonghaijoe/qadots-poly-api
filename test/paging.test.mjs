// Page through the catalog (duonghaijoe/qadots-poly-api#12).
// The default and maximum page size are the coder's choice, but both must be in the README,
// the default must be at least 5, and the maximum at least 10 and below 10000 (these tests build a catalog of 10000 products).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { appFor, storeOf } from '../src/app.mjs';

const BIG = 10000;

// A catalog of `extra` products on top of the 3 seeded ones; every 3rd extra product is tagged "qa-page".
function bigStore(extra) {
  const store = storeOf();
  for (let i = 1; i <= extra; i++) store.add({ name: `Item ${i}`, price: 1 + (i % 7), stock: i % 5, tags: i % 3 === 0 ? ['qa-page'] : ['other'] });
  return store;
}

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

// Walks every page of `query` with page size `limit` and returns all ids in order.
async function walk(s, query, limit) {
  const seen = [];
  for (let offset = 0; ; offset += limit) {
    assert.ok(offset < 1000, "paging never reaches an empty page");
    const { status, body } = await get(s, `?${query}limit=${limit}&offset=${offset}`);
    assert.equal(status, 200);
    if (!body.products.length) return seen;
    assert.ok(body.products.length <= limit);
    seen.push(...ids(body.products));
  }
}

// Every product of the catalog, read page by page.
async function walk2(s) {
  const all = [];
  for (let offset = 0; ; offset += 10) {
    assert.ok(offset < 1000, "paging never reaches an empty page");
    const { body } = await get(s, `?limit=10&offset=${offset}`);
    if (!body.products.length) return all;
    all.push(...body.products);
  }
}

// The maximum page size: what an oversized limit is capped to, or the largest limit that is not refused.
async function maxPageSize(s) {
  const huge = await get(s, '?limit=1000000');
  if (huge.status === 200) return huge.body.products.length;
  let ok = 1;
  let bad = 1000000;
  while (bad - ok > 1) {
    const mid = Math.floor((ok + bad) / 2);
    if ((await get(s, `?limit=${mid}`)).status === 200) ok = mid;
    else bad = mid;
  }
  return ok;
}

test('limit returns at most that many products, from the start of the catalog', async (t) => {
  const s = await serve(t);
  await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2 });
  await s.call('POST', '/api/products', { name: 'Spoon', price: 2, stock: 9 });
  const { status, body } = await get(s, '?limit=2');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [1, 2]);
  assert.equal((await get(s, '?limit=1')).body.products.length, 1);
  assert.equal((await get(s, '?limit=5')).body.products.length, 5);
  assert.equal((await get(s, '?limit=10')).body.products.length, 5, 'a limit above the count returns all of them');
});

test('offset skips that many products', async (t) => {
  const s = await serve(t);
  await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2 });
  await s.call('POST', '/api/products', { name: 'Spoon', price: 2, stock: 9 });
  assert.deepEqual(ids((await get(s, '?offset=0&limit=2')).body.products), [1, 2]);
  assert.deepEqual(ids((await get(s, '?offset=1&limit=2')).body.products), [2, 3]);
  assert.deepEqual(ids((await get(s, '?offset=3&limit=2')).body.products), [4, 5]);
  assert.deepEqual(ids((await get(s, '?offset=4&limit=2')).body.products), [5]);
  assert.deepEqual(ids((await get(s, '?offset=2')).body.products), [3, 4, 5], 'offset alone uses the default page size');
});

test('the response carries the total number of products, not the page size', async (t) => {
  const s = await serve(t);
  await s.call('POST', '/api/products', { name: 'Kettle', price: 30, stock: 2 });
  for (const q of ['', '?limit=2', '?limit=2&offset=2', '?offset=4', '?offset=99']) {
    const { status, body } = await get(s, q);
    assert.equal(status, 200, q);
    assert.equal(body.total, 4, `total for ${q || 'no params'}`);
  }
  await s.call('DELETE', '/api/products/2');
  assert.equal((await get(s, '?limit=1')).body.total, 3, 'the total follows deletes');
});

test('an offset past the end returns 200 with an empty list and the total', async (t) => {
  const s = await serve(t);
  for (const q of ['?offset=3', '?offset=4', '?offset=1000', '?offset=3&limit=1']) {
    const { status, body } = await get(s, q);
    assert.equal(status, 200, q);
    assert.deepEqual(body.products, [], q);
    assert.equal(body.total, 3, q);
  }
});

test('with no params a default page size applies, and the README documents it', async (t) => {
  const s = await serve(t, bigStore(BIG - 3));
  const { status, body } = await get(s);
  assert.equal(status, 200);
  assert.equal(body.total, BIG);
  const size = body.products.length;
  assert.ok(size >= 5 && size < BIG, `the default page size (${size}) should be a real page, between 5 and ${BIG - 1}`);
  assert.deepEqual(ids(body.products), ids((await get(s, `?limit=${size}&offset=0`)).body.products), 'the default page is the first page');
  assert.ok(size <= (await maxPageSize(s)), 'the default page size is within the maximum');

  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /default/i, 'the README talks about the default page size');
  assert.match(readme, new RegExp(`\\b${size}\\b`), `the README states the default page size ${size}`);
});

test('a limit above the maximum is capped or refused with a clear 400, and the README documents the maximum', async (t) => {
  const s = await serve(t, bigStore(BIG - 3));
  const huge = await get(s, '?limit=1000000');
  if (huge.status === 200) {
    assert.ok(huge.body.products.length < BIG, 'an oversized limit must not return the whole catalog');
    assert.equal(huge.body.total, BIG);
  } else {
    assert.equal(huge.status, 400);
    assert.equal(typeof huge.body.error, 'string');
    assert.match(huge.body.error, /limit/i, 'the error names the limit');
    assert.ok(!('products' in huge.body), 'a refused page has no products');
  }
  const max = await maxPageSize(s);
  assert.ok(max >= 10 && max < BIG, `the maximum page size (${max}) should be between 10 and ${BIG - 1}`);
  const atMax = await get(s, `?limit=${max}`);
  assert.equal(atMax.status, 200, 'a limit equal to the maximum is accepted');
  assert.equal(atMax.body.products.length, max);
  const over = await get(s, `?limit=${max + 1}`);
  if (over.status === 200) assert.equal(over.body.products.length, max, 'one above the maximum is capped to it');
  else assert.equal(over.status, 400, 'one above the maximum is refused');

  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /max/i, 'the README talks about the maximum page size');
  assert.match(readme, new RegExp(`\\b${max}\\b`), `the README states the maximum page size ${max}`);
});

for (const [q, name] of [
  ['?limit=-1', 'limit'], ['?limit=0', 'limit'], ['?limit=abc', 'limit'], ['?limit=1.5', 'limit'], ['?limit=2abc', 'limit'], ['?limit=0x10', 'limit'],
  ['?offset=-1', 'offset'], ['?offset=abc', 'offset'], ['?offset=1.5', 'offset'], ['?offset=1abc', 'offset'],
  ['?limit=2&offset=-5', 'offset'], ['?limit=-2&offset=1', 'limit'], ['?tag=sale&limit=zero', 'limit'],
]) {
  test(`${q} is refused with a 400 that names ${name}`, async (t) => {
    const s = await serve(t);
    const { status, body } = await get(s, q);
    assert.equal(status, 400);
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, new RegExp(name, 'i'));
    assert.ok(!('products' in body), 'a refused page has no products');
  });
}

test('offset=0 and limit=1 are valid edges', async (t) => {
  const s = await serve(t);
  assert.deepEqual(ids((await get(s, '?offset=0')).body.products), [1, 2, 3]);
  assert.deepEqual(ids((await get(s, '?limit=1')).body.products), [1]);
});

test('the order is stable: repeated calls give the same page, and the pages cover every product once', async (t) => {
  const s = await serve(t, bigStore(97));
  const first = await get(s, '?limit=7&offset=14');
  for (let i = 0; i < 3; i++) assert.deepEqual(await get(s, '?limit=7&offset=14'), first);

  const all = await walk(s, '', 7);
  assert.equal(all.length, 100);
  assert.equal(new Set(all).size, 100, 'no product shows up on two pages');
  assert.deepEqual(await walk(s, '', 7), all, 'walking again gives the same order');
  assert.deepEqual(await walk(s, '', 10), all, 'a different page size gives the same order');

  // Changing a product's stock or adding one at the end does not reshuffle the earlier pages.
  await s.call('PATCH', '/api/products/20', { stock: 99 });
  await s.call('POST', '/api/products', { name: 'Late', price: 1, stock: 1 });
  assert.deepEqual((await get(s, '?limit=7&offset=14')).body.products.map((p) => p.id), ids(first.body.products));
});

test('paging works with the tag filter: total and pages count only tagged products', async (t) => {
  const s = await serve(t, bigStore(60));
  const tagged = (await walk2(s)).filter((p) => p.tags.includes('qa-page'));
  assert.equal(tagged.length, 20);

  const page = await get(s, '?tag=qa-page&limit=6&offset=6');
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 20);
  assert.deepEqual(ids(page.body.products), ids(tagged.slice(6, 12)));

  for (const q of ['?tag=QA-PAGE&limit=3', '?tag=qa-page&offset=18', '?tag=qa-page&offset=40']) assert.equal((await get(s, q)).body.total, 20, q);
  assert.deepEqual(ids((await get(s, '?tag=qa-page&offset=18&limit=6')).body.products), ids(tagged.slice(18)));
  assert.deepEqual((await get(s, '?tag=qa-page&offset=20')).body.products, []);

  const walked = await walk(s, 'tag=qa-page&', 6);
  assert.deepEqual(walked, ids(tagged), 'walking the tagged pages gives exactly the tagged products, in order');

  const none = await get(s, '?tag=no-such-tag&limit=5');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { products: [], total: 0 });

  const blank = await get(s, '?tag=&limit=5&offset=1');
  assert.equal(blank.body.total, 63, 'an empty tag pages the whole catalog');
  assert.deepEqual(ids(blank.body.products), [2, 3, 4, 5, 6]);
});
