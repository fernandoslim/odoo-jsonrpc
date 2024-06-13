# Odoo JSON-RPC

A lightweight Odoo JSON-RPC client with zero dependencies.

Based on [OdooAwait](https://github.com/vettloffah/odoo-await) which uses XML-RPC. Special thanks to [@vettloffah](https://github.com/vettloffah).

## Performance

JSON-RPC is approximately 20% faster than XML-RPC and allow more request/s

Synthetic Benchmark with [HonoJS](https://github.com/honojs)

hey -n 2000 -c 80 -m GET -H "Content-Type: application/json" -H "Authorization: Bearer honoiscool" http://localhost:3000/v1/contacts/3

JSON-RPC

```bash
Total: 3.2409 secs
Slowest: 0.4474 secs
Fastest: 0.0852 secs
Average: 0.1220 secs
Requests/sec: 617.1133
```

XML-RPC

```bash
Total: 5.6660 secs
Slowest: 0.7938 secs
Fastest: 0.0978 secs
Average: 0.2135 secs
Requests/sec: 352.9848
```

## Node version

Node 18+
Designed to work with Cloudflare Workers

## Installation

```bash
npm install odoo-jsonrpc
```

## Helpers

### Try

Introduced the Try helper, which encapsulates a try/catch block in a smart way. This allows you to make requests and handle responses and errors more reliably, similar to Go.

```js
//Getting a contact by id
export const getContactById = async (contact_id: number) => {
  const [contacts, error] = await Try(() => odoo.read('res.partner', contact_id, ['name', 'email', 'mobile']));
  if (error) {
    throw error;
  }
  if (contacts.length === 0) {
    throw new Error('Contact Not Found.');
  }
  const [contact] = contacts;
  return contact;
};
```

```js
//Create and confirm a Sales Order
export const createSalesOrder = async (salesorder_data: SalesOrder) => {
  //Creating Sales Order
  const [salesorder_id, creating_salesorder_error] = await Try(() => odoo.create('sale.order', salesorder_data));
  if (creating_salesorder_error) {
    throw creating_salesorder_error;
  }
  //Confirming Sales Order
  //If the Sales Order is confirmed, it will return a boolean. Since this value is not used, the underscore (_) is used as a placeholder.
  const [_, confirming_salesorder_error] = await Try(() => odoo.action('sale.order', 'action_confirm', [salesorder_id]));
  if (confirming_salesorder_error) {
    throw confirming_salesorder_error;
  }
  return salesorder_id;
};
```

## Usage

```js
import OdooJSONRpc from '@fernandoslim/odoo-jsonrpc';

const odoo = new OdooJSONRpc({
  baseUrl: process.env.ODOO_BASE_URL!,
  port: Number(process.env.ODOO_PORT!),
  db: process.env.ODOO_DB!,
  username: process.env.ODOO_USERNAME!,
  password: process.env.ODOO_PASSWORD!,
});

await odoo.connect();

const partnerId = await odoo.create("res.partner", {
  name: "Kool Keith",
  email: "lostinspace@example.com",
});
console.log(`Partner created with ID ${partnerId}`);

// If connecting to a dev instance of odoo.sh, your config will looking something like:
const odoo = new OdooJSONRpc({
  baseUrl: 'https://some-database-name-5-29043948.dev.odoo.com/',
  port: 443,
  db: 'some-database-name-5-29043948',
  username: 'myusername',
  password: 'somepassword',
});
```

# Methods

### odoo.connect()

Must be called before other methods.

### odoo.call_kw(model,method,args,kwargs)

This method is wrapped inside the below methods. If below methods don't do what you need, you can use this method. Docs:
[Odoo External API](https://www.odoo.com/documentation/17.0/developer/reference/external_api.html)

### odoo.action(model, action, recordId)

Execute a server action on a record or a set of records. Oddly, the Odoo API returns **false**
if it was successful.

```js
await odoo.action('account.move', 'action_post', [126996, 126995]);
```

## CRUD

#### odoo.create(model, params, externalId)

Returns the ID of the created record. The externalId parameter is special. If supplied, will create a linked record
in the `ir.model.data` model. See the "working with external identifiers" section below for more information.

```js
const partnerId = await odoo.create('res.partner', { name: 'Kool Keith' });
```

#### odoo.read(model, recordId, fields)

Takes an array of record ID's and fetches the record data. Returns an array.
Optionally, you can specify which fields to return. This
is usually a good idea, since there tends to be a lot of fields on the base models (like over 100).
The record ID is always returned regardless of fields specified.

```js
const records = await odoo.read('res.partner', [54, 1568], ['name', 'email']);
console.log(records);
// [ { id: 127362, name: 'Kool Keith', email: 'lostinspace@gmail.com }, { id: 127883, name: 'Jack Dorsey', email: 'jack@twitter.com' } ];
```

#### odoo.update(model, recordId, params)

Returns true if successful

```js
const updated = await odoo.update('res.partner', 54, {
  street: '334 Living Astro Blvd.',
});
console.log(updated); // true
```

#### odoo.delete(model, recordId)

Returns true if successful.

```js
const deleted = await odoo.delete('res.partner', 54);
```

## many2many and one2many fields

Odoo handles the related field lists in a special way. You can choose to:

1. `add` an existing record to the list using the record ID
2. `update` an existing record in the record set using ID and new values
3. `create` a new record on the fly and add it to the list using values
4. `replace` all records with other record(s) without deleting the replaced ones from database - using a list of IDs
5. `delete` one or multiple records from the database

In order to use any of these actions on a field, supply an object as the field value with the following parameters:

- **action** (required) - one of the strings from above
- **id** (required for actions that use id(s) ) - can usually be an array, or a single number
- **value** (required for actions that update or create new related records) - can usually be an single value object, or
  an array of value objects if creating mutliple records

#### Examples

```js
// Create new realted records on the fly
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'create',
    value: [{ name: 'a new category' }, { name: 'another new category' }],
  },
});

// Update a related record in the set
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'update',
    id: 3,
    value: { name: 'Updated category' },
  },
});

// Add existing records to the set
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'add',
    id: 5, // or an array of numbers
  },
});

// Remove from the set but don't delete from database
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'remove',
    id: 5, // or an array of numbers
  },
});

// Remove record and delete from database
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'delete',
    id: 5, // or an array of numbers
  },
});

// Clear all records from set, but don't delete
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'clear',
  },
});

// Replace records in set with other existing records
await odoo.update('res.partner', 278, {
  category_id: {
    action: 'replace',
    id: [3, 12, 6], // or a single number
  },
});

// You can also just do a regular update with an array of IDs, which will accomplish same as above
await odoo.update('res.partner', 278, {
  category_id: [3, 12, 16],
});
```

## Other Odoo API Methods

#### odoo.search(model, domain)

Searches and returns record ID's for all records that match the model and domain.

```js
const recordIds = await odoo.search(`res.partner`, {
  country_id: 'United States',
});
console.log(recordIds); // [14,26,33, ... ]

// Return all records of a certain model (omit domain)
const records = await odoo.searchRead(`res.partner`);
```

#### odoo.searchRead(model, domain, fields, opts)

Searches for matching records and returns record data.
Provide an array of field names if you only want certain fields returned.

```js
const records = await odoo.searchRead(`res.partner`, [['country_id', '=', 'United States']], ['name', 'city'], {
  limit: 5,
  offset: 10,
  order: 'name, desc',
  context: { lang: 'en_US' },
});
console.log(records); // [ { id: 5, name: 'Kool Keith', city: 'Los Angeles' }, ... ]

// Empty domain or other args can be used
const records = await odoo.searchRead(`res.partner`, [], ['name', 'city'], {
  limit: 10,
  offset: 20,
});
```

#### Complex domain filters

A domain filter array can be supplied if any of the alternate domain filters are needed, such as
`<`, `>`, `like`, `=like`, `ilike`, `in` etc. For a complete list check out the
[API Docs](https://www.odoo.com/documentation/14.0/reference/orm.html#reference-orm-domains).
You can also use the logical operators OR `"|"`, AND `"&"`, NOT `"!"`.
Works in both the `search()` and `searchRead()` functions.

```js
// Single domain filter array
const recordIds = await odoo.search('res.partner', ['name', '=like', 'john%']);

// Or a multiple domain filter array (array of arrays)
const recordIds = await odoo.search('res.partner', [
  ['name', '=like', 'john%'],
  ['sale_order_count', '>', 1],
]);

// Logical operator OR
// email is "charlie@example.com" OR name includes "charlie"
const records = await odoo.searchRead('res.partner', ['|', ['email', '=', 'charlie@example.com'], ['name', 'ilike', 'charlie']]);
```

#### odoo.getFields(model, attributes)

Returns detailed list of fields for a model, filtered by attributes. e.g., if you only want to know if fields are required you could call:

```js
const fields = await odoo.getFields('res.partner', ['required']);
console.log(fields);
```

## Working With External Identifiers

External ID's can be important when using the native Odoo import feature with CSV files to sync data between systems, or updating
records using your own unique identifiers instead of the Odoo database ID.

External ID's are created automatically when exporting or importing data using the Odoo
_user interface_, but when working with the API this must be done intentionally.

External IDs are managed separately in the `ir.model.data` model in the database - so these methods make working with
them easier.

#### Module names with external ID's

External ID's require a module name along with the ID. If you don't supply a module name when creating an external ID
with this library, the default module name '**api**' will be used.
What that means is that `'some-unique-identifier'` will live in the database as
`'__api__.some-unique-identifier'`. You do _not_ need to supply the module name when searching using externalId.

#### create(model, params, externalId, moduleName)

If creating a record, simply supply the external ID as the third parameter, and a module name as an optional 4th parameter.
This example creates a record and an external ID in one method. (although it makes two separate `create` calls to the
database under the hood).

```js
const record = await odoo.create('product.product', { name: 'new product' }, 'some-unique-identifier');
```

#### createExternalId(model, recordId, externalId)

For records that are already created without an external ID, you can link an external ID to it.

```js
await odoo.createExternalId('product.product', 76, 'some-unique-identifier');
```

#### readByExternalId(externalId, fields);

Find a record by the external ID, and return whatever fields you want. Leave the `fields` parameter empty to return all
fields.

```js
const record = await odoo.readByExternalId('some-unique-identifier', ['name', 'email']);
```

#### updateByExternalId(externalId, params)

```js
const updated = await odoo.updateByExternalId('some-unique-identifier', {
  name: 'space shoe',
  price: 65479.99,
});
```

## License

ISC

Copyright 2024 Fernando Delgado

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
