# qadots-poly-api

The catalog API of the qadots poly shop: products, stock and cart totals.

```sh
npm start   # http://127.0.0.1:4721 (PORT to change it)
npm test
```

## GET /api/products

Lists the catalog one page at a time, in id order (oldest first), so the same page returns the same products on repeated calls.

| Parameter | Meaning |
|-----------|---------|
| `limit`   | Page size, a whole number from 1 to the maximum. **Default page size: 20.** **Maximum page size: 100**; a larger limit is refused with 400. |
| `offset`  | How many products to skip, a whole number, 0 or more. Default 0. An offset past the end returns an empty list. |
| `tag`     | Only products with this tag (whole tag, case-insensitive, surrounding spaces ignored). Empty means no filter. |

```json
{ "products": [{ "id": 1, "name": "Coffee beans", "price": 12.5, "stock": 40, "tags": ["coffee", "organic", "sale"] }], "total": 3 }
```

`total` counts every product that matches (after the tag filter), not just this page, so the storefront can work out the number of pages.

A `limit` or `offset` that is negative, zero (for limit), not a whole number, or a limit above 100 answers `400 {"error": "..."}` naming the parameter.

Calls with no parameters now get the first 20 products, not the whole catalog: page through with `offset` to get the rest.
