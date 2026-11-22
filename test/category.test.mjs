// Products filter by category with ?category= (a product's category is set when it is created).
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

// On top of the 3 seeded products (no category given): 3 toys, 2 games, 1 toy-ish product with no category.
async function catalog(s) {
  const robot = await add(s, { name: 'Robot', price: 25, stock: 4, category: 'toys', tags: ['sale'] });
  const puzzle = await add(s, { name: 'Puzzle', price: 12, stock: 0, category: 'games', tags: ['toys'] });
  const ball = await add(s, { name: 'Ball', price: 3, stock: 30, category: 'toys' });
  const chess = await add(s, { name: 'Chess', price: 40, stock: 2, category: 'games', tags: ['sale'] });
  const kite = await add(s, { name: 'Kite', price: 15, stock: 7, tags: ['toys'] });
  const doll = await add(s, { name: 'Doll', price: 18, stock: 1, category: 'toys', tags: ['sale'] });
  return { robot, puzzle, ball, chess, kite, doll };
}

test('a product created with a category keeps it', async (t) => {
  const s = await serve(t);
  const robot = await add(s, { name: 'Robot', price: 25, stock: 4, category: 'toys' });
  assert.equal(robot.category, 'toys');
  assert.equal((await s.call('GET', `/api/products/${robot.id}`)).body.category, 'toys');
  assert.equal((await get(s, '?limit=100')).body.products.find((p) => p.id === robot.id).category, 'toys');
});

test('?category=toys lists only toys', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const { status, body } = await get(s, '?category=toys');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), ids([c.robot, c.ball, c.doll]));
  for (const p of body.products) assert.equal(p.category, 'toys', `${p.name} is not a toy`);
});

test('a tag with the same name does not make a product part of the category', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const got = ids((await get(s, '?category=toys')).body.products);
  assert.ok(!got.includes(c.puzzle.id), 'Puzzle is in games, only tagged toys');
  assert.ok(!got.includes(c.kite.id), 'Kite has no category, only a toys tag');
});

test('?category=games lists only games', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const { status, body } = await get(s, '?category=games');
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), ids([c.puzzle, c.chess]));
  assert.equal(body.total, 2);
});

test('an unknown category lists nothing', async (t) => {
  const s = await serve(t);
  await catalog(s);
  for (const q of ['?category=books', '?category=toy', '?category=oys', '?category=toys-and-games', '?category=books&limit=5&offset=0']) {
    const { status, body } = await get(s, q);
    assert.equal(status, 200, q);
    assert.deepEqual(body, { products: [], total: 0 }, q);
  }
});

test('an unknown category lists nothing on the seeded catalog too', async (t) => {
  const s = await serve(t);
  assert.deepEqual((await get(s, '?category=toys')).body, { products: [], total: 0 });
});

test('the total counts the filtered products, not the catalog or the page', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  assert.equal((await get(s, '?category=toys')).body.total, 3);
  assert.equal((await get(s)).body.total, 9, 'without category the total is the whole catalog');

  const page = await get(s, '?category=toys&limit=2');
  assert.deepEqual(ids(page.body.products), ids([c.robot, c.ball]));
  assert.equal(page.body.total, 3, 'the total is not the page size');
  const next = await get(s, '?category=toys&limit=2&offset=2');
  assert.deepEqual(ids(next.body.products), ids([c.doll]));
  assert.equal(next.body.total, 3);
  assert.deepEqual((await get(s, '?category=toys&offset=3')).body, { products: [], total: 3 });

  await add(s, { name: 'Yo-yo', price: 2, stock: 5, category: 'toys' });
  assert.equal((await get(s, '?category=toys')).body.total, 4, 'the total follows new toys');
  await s.call('DELETE', `/api/products/${c.ball.id}`);
  assert.equal((await get(s, '?category=toys')).body.total, 3, 'the total follows deletes');
});

test('category combines with the other filters', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const sale = await get(s, '?category=toys&tag=sale');
  assert.deepEqual(ids(sale.body.products), ids([c.robot, c.doll]));
  assert.equal(sale.body.total, 2);
  assert.deepEqual(ids((await get(s, '?category=toys&maxStock=4')).body.products), ids([c.robot, c.doll]));
  assert.deepEqual(ids((await get(s, '?category=toys&sort=price')).body.products), ids([c.ball, c.doll, c.robot]));
});

test('without category the list is unchanged', async (t) => {
  const s = await serve(t);
  const c = await catalog(s);
  const { status, body } = await get(s);
  assert.equal(status, 200);
  assert.deepEqual(ids(body.products), [1, 2, 3, ...ids(Object.values(c))]);
  assert.equal(body.total, 9);
});
