import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-memory Odoo that speaks both protocols: JSON-RPC (`/jsonrpc`, `/web/session/*`,
 * `/web/dataset/call_kw`) and JSON-2 (`/json/2/<model>/<method>`). It records every call with the
 * shape it arrived in, so tests can check what the client sends on each protocol.
 */

export const DB = 'testdb';
export const LOGIN = 'admin@example.com';
export const PASSWORD = 'secret';
export const API_KEY = 'a'.repeat(40);
export const UID = 2;
const SESSION_ID = 'fake-session-1234';

type Values = Record<string, any>;
export type RecordedCall = {
  protocol: 'jsonrpc' | 'session' | 'json2';
  model: string;
  method: string;
  args?: any[];
  kwargs?: Values;
  params?: Values;
  headers: IncomingMessage['headers'];
};

class FakeUserError extends Error {
  readonly odooName = 'odoo.exceptions.UserError';
}
class FakeNotFound extends Error {
  readonly odooName = 'werkzeug.exceptions.NotFound';
}

/** Positional argument names after the ids, like the Odoo 17+ signatures. */
const SIGNATURES: Record<string, string[]> = {
  create: ['vals_list'],
  read: ['fields'],
  write: ['vals'],
  unlink: [],
  search: ['domain', 'offset', 'limit', 'order'],
  search_read: ['domain', 'fields', 'offset', 'limit', 'order'],
  fields_get: ['allfields', 'attributes'],
  update_field_translations: ['field_name', 'translations'],
  context_get: [],
};
/** `@api.model` methods: no ids. */
const MODEL_METHODS = new Set(['create', 'search', 'search_read', 'fields_get', 'context_get', 'slow', 'boom']);

export class FakeOdoo {
  readonly calls: RecordedCall[] = [];
  private server: Server | undefined;
  private tables = new Map<string, Map<number, Values>>();
  private nextId = 100;
  /** Answer this instead of the real response (once). */
  private overrideOnce: ((res: ServerResponse) => void) | undefined;
  slowMs = 0;

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  reset() {
    this.calls.length = 0;
    this.tables.clear();
    this.nextId = 100;
    this.slowMs = 0;
    this.overrideOnce = undefined;
  }

  seed(model: string, records: Values[]) {
    const table = this.table(model);
    for (const record of records) table.set(record.id, { ...record });
  }

  rows(model: string) {
    return Array.from(this.table(model).values());
  }

  /** Makes the next request answer with a raw response (e.g. an HTML error page). */
  respondOnce(fn: (res: ServerResponse) => void) {
    this.overrideOnce = fn;
  }

  private table(model: string) {
    if (!this.tables.has(model)) this.tables.set(model, new Map());
    return this.tables.get(model)!;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    if (this.overrideOnce) {
      const fn = this.overrideOnce;
      this.overrideOnce = undefined;
      return fn(res);
    }
    if (this.slowMs) await new Promise((resolve) => setTimeout(resolve, this.slowMs));
    const url = req.url ?? '';
    try {
      if (url.startsWith('/json/2/')) return await this.handleJson2(url, req, body, res);
      return this.handleJsonRpc(url, req, body, res);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { message: String(error) });
    }
  }

  // ---------------------------------------------------------------- JSON-RPC

  private handleJsonRpc(url: string, req: IncomingMessage, body: any, res: ServerResponse) {
    const params = body.params ?? {};
    const reply = (result: unknown, headers: Record<string, string> = {}) => json(res, 200, { jsonrpc: '2.0', id: body.id, result }, headers);
    const fail = (name: string, message: string) =>
      json(res, 200, { jsonrpc: '2.0', id: body.id, error: { code: 200, message: 'Odoo Server Error', data: { name, message } } });

    if (url === '/jsonrpc' && params.service === 'common' && params.method === 'authenticate') {
      const [db, login, key] = params.args;
      return reply(db === DB && login === LOGIN && key === API_KEY ? UID : false);
    }
    if (url === '/jsonrpc' && params.service === 'object' && params.method === 'execute_kw') {
      const [db, uid, key, model, method, args = [], kwargs = {}] = params.args;
      if (db !== DB || uid !== UID || key !== API_KEY) return fail('odoo.exceptions.AccessDenied', 'Access Denied');
      this.calls.push({ protocol: 'jsonrpc', model, method, args, kwargs, headers: req.headers });
      return this.runPositional(model, method, args, kwargs, reply, fail);
    }
    if (url === '/web/session/authenticate') {
      if (params.db !== DB || params.login !== LOGIN || params.password !== PASSWORD) {
        return fail('odoo.exceptions.AccessDenied', 'Access Denied');
      }
      return reply({ uid: UID, username: LOGIN, db: DB }, { 'Set-Cookie': `session_id=${SESSION_ID}; Expires=Thu, 01 Jan 2099 00:00:00 GMT; HttpOnly; Path=/` });
    }
    const hasSession = (req.headers.cookie ?? '').includes(`session_id=${SESSION_ID}`);
    if (url === '/web/session/get_session_info') {
      return hasSession ? reply({ uid: UID, username: LOGIN, db: DB }) : fail('odoo.http.SessionExpiredException', 'Session expired');
    }
    if (url === '/web/session/destroy') return reply(null);
    if (url.startsWith('/web/dataset/call_kw')) {
      if (!hasSession) return fail('odoo.http.SessionExpiredException', 'Session expired');
      const { model, method, args = [], kwargs = {} } = params;
      this.calls.push({ protocol: 'session', model, method, args, kwargs, headers: req.headers });
      return this.runPositional(model, method, args, kwargs, reply, fail);
    }
    return json(res, 404, { message: 'not found' });
  }

  private runPositional(model: string, method: string, args: any[], kwargs: Values, reply: (r: unknown) => void, fail: (n: string, m: string) => void) {
    const isModelMethod = MODEL_METHODS.has(method);
    const ids: number[] = isModelMethod ? [] : toIds(args[0]);
    const rest = isModelMethod ? args : args.slice(1);
    const named: Values = { ...kwargs };
    (SIGNATURES[method] ?? []).forEach((name, index) => {
      if (rest[index] !== undefined) named[name] = rest[index];
    });
    try {
      const result = this.execute(model, method, ids, named);
      // execute_kw returns a single id when `create` got a single dict.
      if (method === 'create' && !Array.isArray(rest[0] ?? named.vals_list)) return reply((result as number[])[0]);
      reply(result);
    } catch (error) {
      const name = (error as FakeUserError).odooName ?? 'builtins.Exception';
      fail(name, (error as Error).message);
    }
  }

  // ------------------------------------------------------------------ JSON-2

  private async handleJson2(url: string, req: IncomingMessage, params: Values, res: ServerResponse) {
    const [, , , model, method] = url.split('/');
    if (req.headers.authorization !== `bearer ${API_KEY}`) {
      return json(res, 401, { name: 'werkzeug.exceptions.Unauthorized', message: 'Invalid apikey' });
    }
    if (req.headers['x-odoo-database'] && req.headers['x-odoo-database'] !== DB) {
      return json(res, 404, { name: 'werkzeug.exceptions.NotFound', message: 'database not found' });
    }
    this.calls.push({ protocol: 'json2', model, method, params, headers: req.headers });
    const { ids = [], context, ...named } = params;
    if (MODEL_METHODS.has(method) && ids.length) {
      return json(res, 422, { name: 'werkzeug.exceptions.UnprocessableEntity', message: `cannot call ${model}.${method} with ids` });
    }
    try {
      if (method === 'slow') await new Promise((resolve) => setTimeout(resolve, 200));
      const result = this.execute(model, method, ids, named);
      json(res, 200, result);
    } catch (error) {
      const status = error instanceof FakeNotFound ? 404 : error instanceof FakeUserError ? 422 : 500;
      json(res, status, { name: (error as FakeUserError).odooName ?? 'builtins.Exception', message: (error as Error).message, arguments: [], context: {}, debug: '' });
    }
  }

  // ------------------------------------------------------------------- ORM

  private execute(model: string, method: string, ids: number[], params: Values): unknown {
    if (model === 'no.such.model') throw new FakeNotFound(`no model named ${model}`);
    if (method === 'boom') throw new FakeUserError('Something is wrong with this record');
    if (method === 'context_get') return { lang: 'en_US', tz: 'UTC', uid: UID };
    const table = this.table(model);
    switch (method) {
      case 'create': {
        const list = Array.isArray(params.vals_list) ? params.vals_list : [params.vals_list];
        return list.map((values: Values) => {
          const id = this.nextId++;
          table.set(id, { id, ...values });
          return id;
        });
      }
      case 'read':
        return ids.map((id) => pick(table.get(id)!, params.fields));
      case 'write':
        for (const id of ids) Object.assign(table.get(id)!, params.vals);
        return true;
      case 'unlink':
        for (const id of ids) table.delete(id);
        return true;
      case 'search':
        return filter(Array.from(table.values()), params.domain).map((row) => row.id);
      case 'search_read': {
        const rows = filter(Array.from(table.values()), params.domain);
        const offset = params.offset ?? 0;
        const page = rows.slice(offset, params.limit ? offset + params.limit : undefined);
        return page.map((row) => pick(row, params.fields));
      }
      case 'fields_get':
        return { id: { type: 'integer' }, name: { type: 'char' } };
      case 'update_field_translations':
        for (const id of ids) table.get(id)![`${params.field_name}_translations`] = params.translations;
        return true;
      default:
        // Any other method behaves like a button: it answers with the ids it got.
        for (const id of ids) if (!table.has(id)) throw new FakeUserError(`Record ${id} does not exist`);
        return ids.length ? true : null;
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function toIds(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  return typeof value === 'number' ? [value] : [];
}

function pick(row: Values, fields?: string[]) {
  if (!fields?.length) return { ...row };
  return Object.fromEntries([['id', row.id], ...fields.map((field) => [field, row[field]])]);
}

/** Supports `[[field, '=', value]]` and `[[field, 'in', [...]]]`, enough for the tests. */
function filter(rows: Values[], domain: any[] = []) {
  return rows.filter((row) =>
    domain.every(([field, operator, value]: [string, string, unknown]) =>
      operator === 'in' ? (value as unknown[]).includes(row[field]) : row[field] === value
    )
  );
}
