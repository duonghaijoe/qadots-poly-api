// The catalog API of the shop: products, their stock, and the total of a cart.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const SEED = [
  { name: 'Coffee beans', price: 12.5, stock: 40, tags: ['coffee', 'organic', 'sale'] },
  { name: 'Tea leaves', price: 8, stock: 25, tags: ['tea', 'organic'] },
  { name: 'Mug', price: 6.75, stock: 3, tags: ['kitchen', 'sale'] },
];

export function storeOf() {
  let next = 1;
  const products = new Map();
  const add = (p) => {
    const product = { id: next++, name: p.name, price: p.price, stock: p.stock, tags: [...(p.tags ?? [])] };
    products.set(product.id, product);
    return product;
  };
  SEED.forEach(add);
  return { products, add };
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function bodyOf(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function invalidProduct(b) {
  if (typeof b.name !== 'string' || !b.name.trim()) return 'name is required';
  if (b.name.trim().length > 80) return 'name is longer than 80 characters';
  if (typeof b.price !== 'number' || !(b.price > 0)) return 'price must be a number above 0';
  if (!Number.isInteger(b.stock) || b.stock < 0) return 'stock must be a whole number, 0 or more';
  if (b.tags !== undefined && !(Array.isArray(b.tags) && b.tags.every((t) => typeof t === 'string'))) return 'tags must be a list of strings';
  if (b.tags?.some((t) => !t.trim())) return 'tags must not be blank';
  return null;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// An absent or empty query value takes its fallback; anything else must be a plain whole number (NaN if not).
function whole(params, name, fallback) {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

// Reads limit and offset.
function pageOf(params) {
  const limit = whole(params, 'limit', DEFAULT_PAGE_SIZE);
  if (!(limit >= 1)) return { error: 'limit must be a whole number, 1 or more' };
  if (limit > MAX_PAGE_SIZE) return { error: `limit must be at most ${MAX_PAGE_SIZE}` };
  const offset = whole(params, 'offset', 0);
  if (!(offset >= 0)) return { error: 'offset must be a whole number, 0 or more' };
  return { limit, offset };
}

// The orders ?sort= accepts; ties keep id order, so sorted pages stay stable.
const SORTS = {
  price: (a, b) => a.price - b.price,
  '-price': (a, b) => b.price - a.price,
};

export function appFor(info = {}, store = storeOf()) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/health') return json(res, 200, { ok: true });
    if (path === '/version') return json(res, 200, { name: 'catalog-api', version: pkg.version, sha: info.sha ?? null, env: info.env ?? null });

    if (path === '/api/products' && req.method === 'GET') {
      const page = pageOf(url.searchParams);
      if (page.error) return json(res, 400, { error: page.error });
      const maxStock = whole(url.searchParams, 'maxStock', null);
      if (Number.isNaN(maxStock)) return json(res, 400, { error: 'maxStock must be a whole number, 0 or more' });
      const sort = url.searchParams.get('sort') || null;
      if (sort !== null && !Object.hasOwn(SORTS, sort)) return json(res, 400, { error: `sort must be one of: ${Object.keys(SORTS).join(', ')}` });
      // Ids only grow, so id order is stable: a product keeps its place as others are added or changed.
      let products = [...store.products.values()].sort((a, b) => a.id - b.id);
      // An empty (or blank) tag means no filter; matching is whole-tag and case-insensitive.
      const tag = (url.searchParams.get('tag') ?? '').trim().toLowerCase();
      if (tag) products = products.filter((p) => p.tags.some((t) => t.toLowerCase() === tag));
      // Low stock: at most maxStock left, so maxStock=0 lists the sold out products.
      if (maxStock !== null) products = products.filter((p) => p.stock <= maxStock);
      if (sort) products.sort(SORTS[sort]);
      return json(res, 200, { products: products.slice(page.offset, page.offset + page.limit), total: products.length });
    }
    if (path === '/api/products' && req.method === 'POST') {
      const b = await bodyOf(req);
      if (!b) return json(res, 400, { error: 'the body is not JSON' });
      const why = invalidProduct(b);
      if (why) return json(res, 400, { error: why });
      return json(res, 201, store.add({ name: b.name.trim(), price: b.price, stock: b.stock, tags: b.tags?.map((t) => t.trim()) }));
    }

    const one = path.match(/^\/api\/products\/(\d+)$/);
    if (one) {
      const product = store.products.get(Number(one[1]));
      if (!product) return json(res, 404, { error: 'no such product' });
      if (req.method === 'GET') return json(res, 200, product);
      if (req.method === 'PATCH') {
        const b = await bodyOf(req);
        if (!b) return json(res, 400, { error: 'the body is not JSON' });
        // A restock can send { delta } (how many came in or went out) instead of the new { stock }.
        const next = b.delta !== undefined ? product.stock + b.delta : b.stock;
        if (!Number.isInteger(next)) return json(res, 400, { error: 'stock must be a whole number' });
        product.stock = next;
        return json(res, 200, product);
      }
      if (req.method === 'DELETE') {
        store.products.delete(product.id);
        res.writeHead(204).end();
        return;
      }
    }

    if (path === '/api/cart/total' && req.method === 'POST') {
      const b = await bodyOf(req);
      if (!b || !Array.isArray(b.items)) return json(res, 400, { error: 'items must be a list' });
      // Add up qty per product across all lines, so splitting a product over lines cannot beat the stock check.
      const wanted = new Map();
      for (const item of b.items) {
        const product = store.products.get(Number(item?.id));
        if (!product) return json(res, 400, { error: `no product ${item?.id}` });
        if (!Number.isInteger(item.qty) || item.qty < 1) return json(res, 400, { error: 'qty must be a whole number, 1 or more' });
        wanted.set(product, (wanted.get(product) ?? 0) + item.qty);
      }
      // List every short product in one answer, so the shopper can fix them all at once.
      const short = [...wanted]
        .filter(([product, qty]) => qty > product.stock)
        .map(([product, qty]) => ({ id: product.id, name: product.name, requested: qty, inStock: product.stock }));
      if (short.length) {
        const error = short.map((p) => `only ${p.inStock} of ${p.name} left`).join('; ');
        return json(res, 409, { error, short });
      }
      let total = 0;
      for (const [product, qty] of wanted) total += product.price * qty;
      return json(res, 200, { total: Math.round(total * 100) / 100 });
    }

    json(res, 404, { error: 'not found' });
  };
}
