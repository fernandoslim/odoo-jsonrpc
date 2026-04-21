# Odoo JSON-RPC

Lightweight Odoo JSON-RPC client. Zero dependencies. TypeScript-first. Works on Node 18+, Bun, Deno, and Cloudflare Workers.

Based on [OdooAwait](https://github.com/vettloffah/odoo-await) (XML-RPC). Thanks to [@vettloffah](https://github.com/vettloffah).

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [CRUD](#crud)
- [Search & Search Read](#search--search-read)
- [Domain Filters](#domain-filters)
- [Relational Fields (many2many / one2many)](#relational-fields-many2many--one2many)
- [Field Translations](#field-translations)
- [External Identifiers](#external-identifiers)
- [Error Handling with `Try`](#error-handling-with-try)
- [Disconnect](#disconnect)
- [TypeScript](#typescript)
- [Benchmarks](#benchmarks)
- [License](#license)

## Features

- Zero runtime dependencies
- Dual ESM + CommonJS build with `.d.ts` + `.d.cts`
- Three auth modes: credentials, API key, existing session
- `fetch`-based — runs anywhere `fetch` is available
- Small surface: `create`, `read`, `update`, `delete`, `search`, `searchRead`, `action`, `call_kw`, and external-ID helpers
- Go-style error helper (`Try`) to avoid try/catch noise

## Install

```bash
npm install @fernandoslim/odoo-jsonrpc
# or
pnpm add @fernandoslim/odoo-jsonrpc
# or
bun add @fernandoslim/odoo-jsonrpc
```

Deno / JSR:

```bash
deno add jsr:@fernandoslim/odoo-jsonrpc
```

## Quick Start

```ts
import OdooJSONRpc from '@fernandoslim/odoo-jsonrpc';

const odoo = new OdooJSONRpc({
  baseUrl: process.env.ODOO_BASE_URL!,
  port: Number(process.env.ODOO_PORT!),
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
});

await odoo.connect();

const partnerId = await odoo.create('res.partner', {
  name: 'Kool Keith',
  email: 'lostinspace@example.com',
});

const [partner] = await odoo.read<{ id: number; name: string; email: string }>(
  'res.partner',
  partnerId,
  ['name', 'email']
);
```

## Authentication

`connect()` **must** be called before any other method (except `initialize`).

### With username + password

Returns a full session response including `username`, `partner_id`, `server_version`, etc. Also sets a session cookie used by subsequent calls.

```ts
const odoo = new OdooJSONRpc({
  baseUrl: 'https://my-odoo.example.com',
  port: 443,
  db: 'my-db',
  username: 'admin',
  password: 'secret',
});
await odoo.connect();
```

### With API key

Lightweight. Returns only `{ uid }`. Requests use `execute_kw` via `/jsonrpc`.

```ts
const odoo = new OdooJSONRpc({
  baseUrl: 'https://my-odoo.example.com',
  port: 443,
  db: 'my-db',
  username: 'admin',
  apiKey: 'c721a30555935cbabe8851df3f3eb9e60e850711',
});
await odoo.connect();
```

### With existing session ID

Reuse a session from another source (cookie, cache, etc.).

```ts
const odoo = new OdooJSONRpc({
  baseUrl: 'https://my-odoo.example.com',
  port: 443,
  db: 'my-db',
  sessionId: '12eb065d6b17d27723a72f5dcb0d85071ae346e2',
});
await odoo.connect();
```

### Branching on response type

`connect()` returns either `OdooAuthenticateWithCredentialsResponse` or `OdooAuthenticateWithApiKeyResponse`. Use the `isCredentialsResponse` type guard:

```ts
import OdooJSONRpc, { isCredentialsResponse } from '@fernandoslim/odoo-jsonrpc';

const auth = await odoo.connect();
if (isCredentialsResponse(auth)) {
  console.log('Logged in as', auth.username);
} else {
  console.log('Logged in with API key, uid:', auth.uid);
}
```

### Cloudflare Workers

```ts
import { Hono } from 'hono';
import OdooJSONRpc, { Try } from '@fernandoslim/odoo-jsonrpc';

type Bindings = {
  ODOO_BASE_URL: string;
  ODOO_PORT: number;
  ODOO_DB: string;
  ODOO_USERNAME: string;
  ODOO_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const odoo = new OdooJSONRpc();

app.use('/odoo/*', async (c, next) => {
  if (!odoo.is_connected) {
    await odoo.connect({
      baseUrl: c.env.ODOO_BASE_URL,
      port: c.env.ODOO_PORT,
      db: c.env.ODOO_DB,
      username: c.env.ODOO_USERNAME,
      apiKey: c.env.ODOO_API_KEY,
    });
  }
  return next();
});

app.get('/odoo/contacts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [contacts, error] = await Try(() =>
    odoo.read<{ id: number; name: string; email: string }>('res.partner', id, ['name', 'email'])
  );
  if (error) return c.text(error.message, 422);
  if (!contacts.length) return c.text('not found', 404);
  return c.json(contacts[0], 200);
});
```

## API Reference

| Method | Signature | Returns |
|---|---|---|
| `connect` | `connect(config?)` | auth response |
| `disconnect` | `disconnect()` | `boolean` |
| `call_kw` | `call_kw(model, method, args, kwargs?)` | `any` |
| `create` | `create(model, values)` | `number` (id) |
| `read<T>` | `read(model, id \| ids, fields)` | `T[]` |
| `update` | `update(model, id, values)` | `boolean` |
| `delete` | `delete(model, id)` | `boolean` |
| `search` | `search(model, domain)` | `number[]` |
| `searchRead<T>` | `searchRead(model, domain, fields, opts?)` | `T[]` |
| `getFields` | `getFields(model)` | fields map |
| `action` | `action(model, action, ids)` | `boolean` |
| `updateFieldTranslations` | `updateFieldTranslations(model, id, field, translations)` | `boolean` |
| `createExternalId` | `createExternalId(model, recordId, externalId, moduleName?)` | `number` |
| `searchByExternalId` | `searchByExternalId(externalId)` | `number` |
| `readByExternalId<T>` | `readByExternalId(externalId, fields?)` | `T` |
| `updateByExternalId` | `updateByExternalId(externalId, params)` | `boolean` |
| `deleteByExternalId` | `deleteByExternalId(externalId)` | `boolean` |

If a method you need is not wrapped, use `call_kw` directly. See [Odoo External API](https://www.odoo.com/documentation/17.0/developer/reference/external_api.html).

## CRUD

### Create

```ts
const partnerId = await odoo.create('res.partner', { name: 'Kool Keith' });
```

> To attach an external ID at creation time, call `createExternalId` afterwards. See [External Identifiers](#external-identifiers).

### Read

Returns an array. Pass a single ID or an array of IDs. Always pass a `fields` list — base models (like `res.partner`) have 100+ fields.

```ts
type Partner = { id: number; name: string; email: string };
const records = await odoo.read<Partner>('res.partner', [54, 1568], ['name', 'email']);
```

### Update

```ts
const ok = await odoo.update('res.partner', 54, { street: '334 Living Astro Blvd.' });
```

### Delete

```ts
const ok = await odoo.delete('res.partner', 54);
```

### Server actions

```ts
await odoo.action('account.move', 'action_post', [126996, 126995]);
```

> Odoo server actions commonly return `false` on success.

## Search & Search Read

### search

Returns matching record IDs.

```ts
const ids = await odoo.search('res.partner', [['country_id', '=', 'US']]);
```

### searchRead

Returns matching records with selected fields. Supports `offset`, `limit`, `order`, and `context`.

```ts
type Partner = { id: number; name: string; city: string };
const records = await odoo.searchRead<Partner>(
  'res.partner',
  [['country_id', '=', 'US']],
  ['name', 'city'],
  { limit: 5, offset: 10, order: 'name desc', context: { lang: 'en_US' } }
);

// Empty domain = all records
const all = await odoo.searchRead<Partner>('res.partner', [], ['name', 'city'], { limit: 10 });
```

## Domain Filters

Odoo domains are arrays of triples `[field, operator, value]`. Common operators: `=`, `!=`, `<`, `>`, `<=`, `>=`, `like`, `=like`, `ilike`, `in`, `not in`, `child_of`. Logical operators: `|` (OR), `&` (AND, implicit), `!` (NOT).

Full list: [Odoo ORM Domains](https://www.odoo.com/documentation/17.0/developer/reference/backend/orm.html#search-domains).

```ts
// Single triple
await odoo.search('res.partner', [['name', '=like', 'john%']]);

// Multiple triples (AND is implicit)
await odoo.search('res.partner', [
  ['name', '=like', 'john%'],
  ['sale_order_count', '>', 1],
]);

// OR: email = X OR name ilike Y
await odoo.searchRead('res.partner', [
  '|',
  ['email', '=', 'charlie@example.com'],
  ['name', 'ilike', 'charlie'],
]);
```

## Relational Fields (many2many / one2many)

Values are passed to Odoo **raw**. Use Odoo's native [Command tuples](https://www.odoo.com/documentation/17.0/developer/reference/backend/orm.html#odoo.fields.Command):

| Command | Meaning |
|---|---|
| `[0, 0, {values}]` | create a new related record and link it |
| `[1, id, {values}]` | update existing related record |
| `[2, id]` | unlink and **delete** from DB |
| `[3, id]` | unlink without deleting |
| `[4, id]` | link an existing record |
| `[5]` | unlink all (no delete) |
| `[6, 0, [ids]]` | replace link set with given IDs |

Examples:

```ts
// Create a new related category on the fly
await odoo.update('res.partner', 278, {
  category_id: [[0, 0, { name: 'A new category' }]],
});

// Update an existing related category
await odoo.update('res.partner', 278, {
  category_id: [[1, 3, { name: 'Updated category' }]],
});

// Link existing categories (ids 3, 12, 6)
await odoo.update('res.partner', 278, {
  category_id: [[6, 0, [3, 12, 6]]],
});

// Unlink without deleting
await odoo.update('res.partner', 278, {
  category_id: [[3, 5]],
});

// Unlink and delete from DB
await odoo.update('res.partner', 278, {
  category_id: [[2, 5]],
});
```

## Field Translations

Update a translatable field across languages.

```ts
await odoo.updateFieldTranslations('product.template', 1, 'name', {
  de_DE: 'Neuer Name',
  en_GB: 'New name',
});
```

## External Identifiers

External IDs (stored in `ir.model.data`) let you reference records by a stable key across systems — useful for CSV imports and third-party syncs.

Default module name is `__api__`, so an external ID like `'sku-42'` becomes `'__api__.sku-42'` in the DB. You can override with the `moduleName` parameter on `createExternalId`. When looking up, you do **not** need the module prefix.

```ts
// Link an external ID to an existing record
await odoo.createExternalId('product.product', 76, 'sku-42');

// Find id by external ID
const id = await odoo.searchByExternalId('sku-42');

// Read fields by external ID
const record = await odoo.readByExternalId<{ name: string; list_price: number }>(
  'sku-42',
  ['name', 'list_price']
);

// Update by external ID
await odoo.updateByExternalId('sku-42', { name: 'space shoe', list_price: 65479.99 });

// Delete by external ID
await odoo.deleteByExternalId('sku-42');
```

## Error Handling with `Try`

`Try` wraps a promise and returns `[result, null] | [null, error]` — no `try/catch` boilerplate.

```ts
import OdooJSONRpc, { Try } from '@fernandoslim/odoo-jsonrpc';

const [contacts, error] = await Try(() =>
  odoo.read<{ id: number; name: string }>('res.partner', 54, ['name'])
);
if (error) throw error;
if (!contacts.length) throw new Error('Contact not found');
const [contact] = contacts;
```

Real-world example — create and confirm a Sales Order:

```ts
export const createSalesOrder = async (data: SalesOrder) => {
  const [id, createErr] = await Try(() => odoo.create('sale.order', data));
  if (createErr) throw createErr;

  const [, confirmErr] = await Try(() => odoo.action('sale.order', 'action_confirm', [id]));
  if (confirmErr) throw confirmErr;

  return id;
};
```

## Disconnect

Ends the session on the server (credentials / session-ID modes only).

```ts
await odoo.disconnect();
```

## TypeScript

All exports are fully typed. Key types:

```ts
import type {
  OdooConnection,
  ConnectionWithCredentials,
  ConnectionWithSession,
  OdooSearchDomain,
  OdooSearchReadOptions,
  OdooAuthenticateWithCredentialsResponse,
  OdooAuthenticateWithApiKeyResponse,
  UserContext,
  UserSettings,
} from '@fernandoslim/odoo-jsonrpc';
```

`read<T>` and `searchRead<T>` accept a generic for the row shape, so you get typed records without casting.

## Benchmarks

Synthetic benchmark with [Hono](https://github.com/honojs) — `hey -n 2000 -c 80`:

|          | Req/sec  | Avg      |
|----------|----------|----------|
| JSON-RPC | 617.11   | 122 ms   |
| XML-RPC  | 352.98   | 213 ms   |

JSON-RPC handled ~75% more requests per second and ran ~43% faster on average.

## License

ISC — Copyright 2024 Fernando Delgado. See source for full text.
