import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import OdooJSONRpc, { isCredentialsResponse, OdooError } from '../src';
import { API_KEY, DB, FakeOdoo, LOGIN, PASSWORD, UID } from './fake-odoo';

const odoo = new FakeOdoo();
let baseUrl = '';

beforeAll(async () => {
  baseUrl = await odoo.start();
});
afterAll(() => odoo.stop());
beforeEach(() => odoo.reset());

const withApiKey = (extra = {}) => new OdooJSONRpc({ baseUrl, db: DB, username: LOGIN, apiKey: API_KEY, ...extra });
const withPassword = () => new OdooJSONRpc({ baseUrl, db: DB, username: LOGIN, password: PASSWORD });

describe('connect (jsonrpc)', () => {
  it('accepts a baseUrl without port', async () => {
    const client = withApiKey();
    expect(client.url).toBe(baseUrl);
    await expect(client.connect()).resolves.toEqual({ uid: UID });
    expect(client.is_connected).toBe(true);
  });

  it('still joins baseUrl and port when both are given', () => {
    const [host, port] = baseUrl.split(/:(?=\d+$)/);
    const client = new OdooJSONRpc({ baseUrl: `${host}/`, port: Number(port), db: DB, username: LOGIN, apiKey: API_KEY });
    expect(client.url).toBe(baseUrl);
  });

  it('rejects a wrong API key instead of connecting with uid false', async () => {
    const client = withApiKey({ apiKey: 'wrong' });
    const error = await client.connect().catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.status).toBe(401);
    expect(client.is_connected).toBe(false);
  });

  it('logs in with password and keeps the session cookie', async () => {
    const client = withPassword();
    const auth = await client.connect();
    expect(isCredentialsResponse(auth)).toBe(true);
    expect(client.sessionId).toBe('fake-session-1234');
    odoo.seed('res.partner', [{ id: 1, name: 'Ana' }]);
    await client.read('res.partner', 1, ['name']);
    expect(odoo.calls.at(-1)).toMatchObject({ protocol: 'session', method: 'read', args: [1, ['name']] });
  });

  it('turns a rejected password into an OdooError with the Odoo exception', async () => {
    const client = new OdooJSONRpc({ baseUrl, db: DB, username: LOGIN, password: 'nope' });
    const error = await client.connect().catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.exceptionName).toBe('odoo.exceptions.AccessDenied');
    expect(error.message).toBe('Access Denied');
  });

  it('reuses an existing session and reports an expired one', async () => {
    await expect(new OdooJSONRpc({ baseUrl, db: DB, sessionId: 'fake-session-1234' }).connect()).resolves.toMatchObject({ uid: UID });
    const error = await new OdooJSONRpc({ baseUrl, db: DB, sessionId: 'old' }).connect().catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.exceptionName).toBe('odoo.http.SessionExpiredException');
  });

  it('asks for baseUrl and db', async () => {
    await expect(new OdooJSONRpc({ db: DB }).connect()).rejects.toThrow(OdooError);
    await expect(new OdooJSONRpc({ baseUrl }).connect()).rejects.toThrow('baseUrl and db');
  });
});

describe('helpers keep their positional arguments (jsonrpc)', () => {
  it('create, read, update, delete', async () => {
    const client = withApiKey();
    const id = await client.create('res.partner', { name: 'Ana' });
    expect(id).toBe(100);
    expect(odoo.calls.at(-1)).toMatchObject({ protocol: 'jsonrpc', method: 'create', args: [{ name: 'Ana' }] });

    await expect(client.read('res.partner', id, ['name'])).resolves.toEqual([{ id, name: 'Ana' }]);
    expect(odoo.calls.at(-1)?.args).toEqual([id, ['name']]);

    await client.update('res.partner', id, { name: 'Ana María' });
    expect(odoo.calls.at(-1)?.args).toEqual([[id], { name: 'Ana María' }]);

    await client.delete('res.partner', id);
    expect(odoo.calls.at(-1)?.args).toEqual([[id]]);
    expect(odoo.rows('res.partner')).toEqual([]);
  });

  it('create with a list keeps returning the list of ids', async () => {
    const ids = await withApiKey().create('res.partner', [{ name: 'A' }, { name: 'B' }]);
    expect(ids).toEqual([100, 101]);
  });

  it('search and searchRead send domain and fields positionally, options as kwargs', async () => {
    odoo.seed('res.partner', [
      { id: 1, name: 'Ana', is_company: false },
      { id: 2, name: 'Acme', is_company: true },
    ]);
    const client = withApiKey();
    await expect(client.search('res.partner', [['is_company', '=', true]])).resolves.toEqual([2]);
    expect(odoo.calls.at(-1)?.args).toEqual([[['is_company', '=', true]]]);

    const rows = await client.searchRead('res.partner', [], ['name'], { limit: 1, offset: 1 });
    expect(rows).toEqual([{ id: 2, name: 'Acme' }]);
    expect(odoo.calls.at(-1)).toMatchObject({ args: [[], ['name']], kwargs: { limit: 1, offset: 1 } });
  });

  it('action sends every id, not just the first one', async () => {
    odoo.seed('sale.order', [{ id: 1 }, { id: 2 }]);
    await expect(withApiKey().action('sale.order', 'action_confirm', [1, 2])).resolves.toBe(true);
    expect(odoo.calls.at(-1)?.args).toEqual([[1, 2]]);
  });

  it('createExternalId returns the id, as its type says', async () => {
    const id = await withApiKey().createExternalId('res.partner', 5, 'partner_5');
    expect(id).toBe(100);
    expect(odoo.calls.at(-1)?.args).toEqual([[{ model: 'res.partner', name: 'partner_5', res_id: 5, module: '__api__' }]]);
  });

  it('call() translates named parameters to execute_kw', async () => {
    odoo.seed('res.partner', [{ id: 1, name: 'Ana' }]);
    await withApiKey().call('res.partner', 'read', { ids: [1], fields: ['name'] });
    expect(odoo.calls.at(-1)).toMatchObject({ args: [[1]], kwargs: { fields: ['name'] } });
  });
});

describe('errors (jsonrpc)', () => {
  it('carry the model, the method and the Odoo exception', async () => {
    const error = await withApiKey()
      .call_kw('res.partner', 'boom', [])
      .catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error).toMatchObject({
      message: 'Something is wrong with this record',
      model: 'res.partner',
      method: 'boom',
      exceptionName: 'odoo.exceptions.UserError',
    });
  });

  it('report an HTML page instead of failing to parse it', async () => {
    const client = withApiKey();
    await client.connect();
    odoo.respondOnce((res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>Bad Gateway</html>');
    });
    const error = await client.search('res.partner', []).catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.status).toBe(502);
    expect(error.message).toContain('Bad Gateway');
  });

  it('time out when timeoutMs is set', async () => {
    const client = withApiKey({ timeoutMs: 50 });
    odoo.slowMs = 300;
    const error = await client.connect().catch((e) => e);
    expect(error).toBeInstanceOf(OdooError);
    expect(error.message).toContain('50 ms');
  });
});

describe('disconnect', () => {
  it('destroys the session', async () => {
    const client = withPassword();
    await client.connect();
    await expect(client.disconnect()).resolves.toBe(true);
    expect(client.sessionId).toBeUndefined();
    expect(client.is_connected).toBe(false);
  });

  it('with an API key only clears the local state', async () => {
    const client = withApiKey();
    await client.connect();
    await expect(client.disconnect()).resolves.toBe(true);
    expect(client.uId).toBeUndefined();
  });
});
