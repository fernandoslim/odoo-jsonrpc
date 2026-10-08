import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import OdooJSONRpc, { OdooError } from '../src';
import { API_KEY, DB, FakeOdoo, UID } from './fake-odoo';

const odoo = new FakeOdoo();
let baseUrl = '';

beforeAll(async () => {
  baseUrl = await odoo.start();
});
afterAll(() => odoo.stop());
beforeEach(() => odoo.reset());

const json2 = (extra = {}) => new OdooJSONRpc({ baseUrl, db: DB, apiKey: API_KEY, protocol: 'json2', ...extra });

describe('connect (json2)', () => {
  it('checks the key with context_get and keeps the uid', async () => {
    const client = json2();
    await expect(client.connect()).resolves.toEqual({ uid: UID });
    expect(client.uId).toBe(UID);
    expect(odoo.calls.at(-1)).toMatchObject({ protocol: 'json2', model: 'res.users', method: 'context_get', params: {} });
  });

  it('sends the key as bearer and the database in X-Odoo-Database', async () => {
    await json2().connect();
    const { headers } = odoo.calls.at(-1)!;
    expect(headers.authorization).toBe(`bearer ${API_KEY}`);
    expect(headers['x-odoo-database']).toBe(DB);
  });

  it('works without db (single-database servers)', async () => {
    await json2({ db: undefined }).connect();
    expect(odoo.calls.at(-1)?.headers['x-odoo-database']).toBeUndefined();
  });

  it('rejects a wrong key with status 401', async () => {
    const error = await json2({ apiKey: 'wrong' })
      .connect()
      .catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.status).toBe(401);
    expect(error.message).toContain('Invalid apikey');
  });

  it('needs an API key', async () => {
    await expect(new OdooJSONRpc({ baseUrl, protocol: 'json2' }).connect()).rejects.toThrow('apiKey');
  });

  it('connects on the first call', async () => {
    odoo.seed('res.partner', [{ id: 1, name: 'Ana' }]);
    const client = json2();
    await expect(client.search('res.partner', [])).resolves.toEqual([1]);
    expect(client.is_connected).toBe(true);
  });
});

describe('helpers send named parameters (json2)', () => {
  it('create, read, update, delete', async () => {
    const client = json2();
    const id = await client.create('res.partner', { name: 'Ana' });
    expect(id).toBe(100);
    expect(odoo.calls.at(-1)).toMatchObject({ method: 'create', params: { vals_list: [{ name: 'Ana' }] } });

    await expect(client.read('res.partner', id, ['name'])).resolves.toEqual([{ id, name: 'Ana' }]);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [id], fields: ['name'] });

    await expect(client.update('res.partner', id, { name: 'Ana María' })).resolves.toBe(true);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [id], vals: { name: 'Ana María' } });

    await expect(client.delete('res.partner', id)).resolves.toBe(true);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [id] });
  });

  it('create with a list returns every id', async () => {
    await expect(json2().create('res.partner', [{ name: 'A' }, { name: 'B' }])).resolves.toEqual([100, 101]);
  });

  it('searchRead passes paging and context by name', async () => {
    odoo.seed('res.partner', [
      { id: 1, name: 'Ana' },
      { id: 2, name: 'Beto' },
    ]);
    const rows = await json2().searchRead('res.partner', [], ['name'], { limit: 1, offset: 1, order: 'name', context: { lang: 'es_419' } });
    expect(rows).toEqual([{ id: 2, name: 'Beto' }]);
    expect(odoo.calls.at(-1)?.params).toEqual({ domain: [], fields: ['name'], limit: 1, offset: 1, order: 'name', context: { lang: 'es_419' } });
  });

  it('action, getFields and updateFieldTranslations', async () => {
    odoo.seed('sale.order', [{ id: 1 }, { id: 2 }]);
    odoo.seed('product.template', [{ id: 7, name: 'Faja' }]);
    const client = json2();
    await expect(client.action('sale.order', 'action_confirm', [1, 2])).resolves.toBe(true);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [1, 2] });

    await expect(client.getFields('res.partner')).resolves.toHaveProperty('name');
    expect(odoo.calls.at(-1)?.params).toEqual({});

    await client.updateFieldTranslations('product.template', 7, 'name', { en_US: 'Shapewear' });
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [7], field_name: 'name', translations: { en_US: 'Shapewear' } });
  });

  it('external ids use ir.model.data the same way', async () => {
    const client = json2();
    await expect(client.createExternalId('res.partner', 5, 'partner_5')).resolves.toBe(100);
    await expect(client.searchByExternalId('partner_5')).resolves.toBe(5);
  });
});

describe('call and call_kw (json2)', () => {
  it('call() posts the params as they are', async () => {
    odoo.seed('res.partner', [{ id: 1, name: 'Ana' }]);
    await expect(json2().call('res.partner', 'read', { ids: [1], fields: ['name'] })).resolves.toEqual([{ id: 1, name: 'Ana' }]);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [1], fields: ['name'] });
  });

  it('call_kw with only ids (or nothing) is translated', async () => {
    odoo.seed('sale.order', [{ id: 3 }]);
    const client = json2();
    await expect(client.call_kw('sale.order', 'action_confirm', [[3]])).resolves.toBe(true);
    expect(odoo.calls.at(-1)?.params).toEqual({ ids: [3] });
    await client.call_kw('res.partner', 'search', [], { domain: [] });
    expect(odoo.calls.at(-1)?.params).toEqual({ domain: [] });
  });

  it('call_kw with other positional arguments points to call()', async () => {
    const error = await json2()
      .call_kw('res.partner', 'search', [[['id', '=', 1]]])
      .catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.message).toContain("call('res.partner', 'search'");
  });
});

describe('errors (json2)', () => {
  it('a UserError keeps its status, exception name and message', async () => {
    const error = await json2()
      .call('res.partner', 'boom')
      .catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error).toMatchObject({
      status: 422,
      exceptionName: 'odoo.exceptions.UserError',
      message: 'Something is wrong with this record',
      model: 'res.partner',
      method: 'boom',
    });
  });

  it('an unknown model is a 404', async () => {
    const error = await json2()
      .search('no.such.model', [])
      .catch((e) => e);
    expect(error).toMatchObject({ status: 404, model: 'no.such.model', method: 'search' });
  });

  it('times out', async () => {
    const client = json2({ timeoutMs: 50 });
    odoo.slowMs = 300;
    const error = await client.connect().catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.message).toContain('50 ms');
  });
});
