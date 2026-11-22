# qadots-poly-api

The catalog API of the qadots poly shop: products, stock and cart totals.

```sh
npm start   # http://127.0.0.1:4721 (PORT to change it)
npm test
```

## GET /api/products

Lists the catalog one page at a time, in id order (oldest first) unless `sort` says otherwise, so the same page returns the same products on repeated calls.

| Parameter | Meaning |
|-----------|---------|
| `limit`   | Page size, a whole number from 1 to the maximum. **Default page size: 20.** **Maximum page size: 100**; a larger limit is refused with 400. |
| `offset`  | How many products to skip, a whole number, 0 or more. Default 0. An offset past the end returns an empty list. |
| `q`       | Only products whose name has this text in it, any case, as plain text (not a pattern); surrounding spaces ignored. Searches the name only, not tags or category. Empty means no filter; no match lists nothing (`total` 0). |
| `tag`     | Only products with this tag (whole tag, case-insensitive, surrounding spaces ignored). Empty means no filter. |
| `category` | Only products in this category (whole name, case-insensitive, surrounding spaces ignored). A category no product has lists nothing (`total` 0). A tag of the same name does not count. Empty means no filter. |
| `maxStock` | Only products with at most this many in stock, a whole number, 0 or more; `maxStock=0` lists the sold out products. Empty means no filter. |
| `sort`    | `price` lists the cheapest first, `-price` the most expensive first; equal prices keep id order. Without it, id order. Any other value answers 400 naming the allowed values. |

```json
{ "products": [{ "id": 1, "name": "Coffee beans", "price": 12.5, "stock": 40, "category": null, "tags": ["coffee", "organic", "sale"] }], "total": 3 }
```

`total` counts every product that matches (after the `q`, `tag`, `category` and `maxStock` filters), not just this page, so the storefront can work out the number of pages.

An unknown `sort`, a `maxStock` that is not a whole number 0 or more, or a `limit` or `offset` that is negative, zero (for limit), not a whole number, or a limit above 100 answers `400 {"error": "..."}` naming the parameter.

`POST /api/products` takes an optional `category` (a non-blank string, trimmed); products created without one, like the seeded ones, have `category: null`.

Calls with no parameters now get the first 20 products, not the whole catalog: page through with `offset` to get the rest.
