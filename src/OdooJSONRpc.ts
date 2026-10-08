export type OdooSearchDomain = any | any[];

export interface OdooSearchReadOptions {
  offset?: number;
  limit?: number;
  order?: string;
  context?: any;
}
export type OdooAuthenticateWithApiKeyResponse = {
  uid: number;
};
export type OdooAuthenticateWithCredentialsResponse = {
  uid: number;
  is_system: boolean;
  is_admin: boolean;
  is_internal_user: boolean;
  user_context: UserContext;
  db: string;
  user_settings: UserSettings;
  server_version: string;
  server_version_info: [number, number, number, string, number, string];
  support_url: string;
  name: string;
  username: string;
  partner_display_name: string;
  partner_id: number;
  'web.base.url': string;
  active_ids_limit: number;
  profile_session: any;
  profile_collectors: any;
  profile_params: any;
  max_file_upload_size: number;
  home_action_id: boolean;
  cache_hashes: any;
  currencies: any;
  bundle_params: any;
  user_companies: any;
  show_effect: boolean;
  display_switch_company_menu: boolean;
  user_id: number[];
  max_time_between_keys_in_ms: number;
  web_tours: any[];
  tour_disable: boolean;
  notification_type: string;
  warning: string;
  expiration_date: string;
  expiration_reason: string;
  map_box_token: boolean;
  odoobot_initialized: boolean;
  iap_company_enrich: boolean;
  ocn_token_key: boolean;
  fcm_project_id: boolean;
  inbox_action: number;
  is_quick_edit_mode_enabled: string;
  dbuuid: string;
  multi_lang: boolean;
};

export type UserContext = {
  lang: string;
  tz: string;
  uid: number;
};

export type UserSettings = {
  id: number;
  user_id: UserId;
  is_discuss_sidebar_category_channel_open: boolean;
  is_discuss_sidebar_category_chat_open: boolean;
  push_to_talk_key: boolean;
  use_push_to_talk: boolean;
  voice_active_duration: number;
  volume_settings_ids: [string, any[]][];
  homemenu_config: boolean;
};

export type UserId = {
  id: number;
};

/**
 * - `jsonrpc` (default): `/jsonrpc` + `/web/session/*`. Works on every Odoo version, but Odoo
 *   deprecated it in 19 and removes it in 22.
 * - `json2`: the External JSON-2 API of Odoo 19+ (`POST /json/2/<model>/<method>`, bearer API key).
 */
export type OdooProtocol = 'jsonrpc' | 'json2';

export type OdooConnectionBase = {
  baseUrl?: string;
  /** Optional: leave it out when `baseUrl` already points to the right port (e.g. `https://…`). */
  port?: number;
  db?: string;
  protocol?: OdooProtocol;
  /** Aborts any request that takes longer than this (ms). No timeout by default. */
  timeoutMs?: number;
};

export interface ConnectionWithSession extends OdooConnectionBase {
  sessionId?: string;
}

export interface ConnectionWithCredentials extends OdooConnectionBase {
  username?: string;
  password?: string;
  apiKey?: string;
}

export type OdooConnection = ConnectionWithSession | ConnectionWithCredentials;

/** Named parameters of a JSON-2 call: `ids` and `context` plus the method's own arguments. */
export type OdooCallParams = {
  ids?: number[];
  context?: Record<string, unknown>;
  [param: string]: unknown;
};

/**
 * Every failure of the client: network, timeout, HTTP status, a non-JSON response or an error
 * raised by Odoo. `exceptionName` is Odoo's (e.g. `odoo.exceptions.AccessError`).
 */
export class OdooError extends Error {
  readonly status?: number;
  readonly model?: string;
  readonly method?: string;
  readonly exceptionName?: string;
  readonly data?: unknown;

  constructor(
    message: string,
    details: { status?: number; model?: string; method?: string; exceptionName?: string; data?: unknown; cause?: unknown } = {}
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'OdooError';
    this.status = details.status;
    this.model = details.model;
    this.method = details.method;
    this.exceptionName = details.exceptionName;
    this.data = details.data;
  }
}

export const Try = async <T>(fn: () => Promise<T>): Promise<[T, null] | [null, Error]> => {
  try {
    const result = await fn();
    return [result, null];
  } catch (e) {
    const error = e as Error;
    return [null, error];
  }
};
/**
 * Type guard to determine if the authentication response is a full credentials response.
 *
 * This function distinguishes between the two possible authentication response types:
 * - OdooAuthenticateWithCredentialsResponse (full response with user details)
 * - OdooAuthenticateWithApiKeyResponse (simple response with just the user ID)
 *
 * It checks for the presence of the 'username' property, which is only available
 * in the full credentials response.
 *
 * @param response - The authentication response to check
 * @returns true if the response is a full credentials response, false otherwise
 *
 * @example
 * const authResponse = await odoo.connect();
 * if (isCredentialsResponse(authResponse)) {
 *   console.log("Authenticated user:", authResponse.username);
 * } else {
 *   console.log("Authenticated with API key, user ID:", authResponse.uid);
 * }
 */
export const isCredentialsResponse = (
  response: OdooAuthenticateWithCredentialsResponse | OdooAuthenticateWithApiKeyResponse
): response is OdooAuthenticateWithCredentialsResponse => {
  return response && 'username' in response;
};

type RequestContext = { model?: string; method?: string };

export default class OdooJSONRpc {
  public url: string | undefined = undefined;
  public is_connected = false;
  private session_id: string | undefined = undefined;
  private auth_response: any = null;
  private uid: number | undefined = undefined;
  private api_key: string | undefined = undefined;
  private config: OdooConnection = {};

  constructor(config: OdooConnection = {}) {
    this.initialize(config);
  }
  get uId(): number | undefined {
    return this.uid ?? this.auth_response?.uid;
  }
  get authResponse(): OdooAuthenticateWithCredentialsResponse | undefined {
    return this.auth_response;
  }
  get sessionId(): string | undefined {
    return this.session_id;
  }
  get port(): number | undefined {
    return this.config?.port;
  }
  get protocol(): OdooProtocol {
    return this.config?.protocol ?? 'jsonrpc';
  }
  //Initializes the OdooJSONRpc instance with the provided configuration.
  public initialize(config: OdooConnection) {
    this.config = config;
    this.url = undefined;
    if (config.baseUrl) {
      const base = config.baseUrl.replace(/\/+$/, '');
      this.url = config.port ? `${base}:${config.port}` : base;
    }
    this.session_id = undefined;
    this.api_key = undefined;
    if ('sessionId' in config && config.sessionId) {
      this.session_id = config.sessionId;
    } else if ('apiKey' in config && config.apiKey) {
      this.api_key = config.apiKey;
    }
    this.is_connected = false;
    this.auth_response = undefined;
    this.uid = undefined;
  }
  //Connects to the Odoo server using the provided or existing configuration.
  async connect(config?: OdooConnection): Promise<OdooAuthenticateWithCredentialsResponse | OdooAuthenticateWithApiKeyResponse> {
    if (config) {
      this.initialize(config);
    }
    if (this.protocol === 'json2') {
      if (!this.url) {
        throw new OdooError('Incomplete configuration. Please provide baseUrl.');
      }
      if (!this.api_key) {
        throw new OdooError('The json2 protocol needs an apiKey.');
      }
    } else if (!this.url || !this.config.db) {
      throw new OdooError('Incomplete configuration. Please provide baseUrl and db.');
    }
    const result = await (this.protocol === 'json2'
      ? this.connectWithJson2()
      : 'sessionId' in this.config
      ? this.connectWithSessionId()
      : 'apiKey' in this.config
      ? this.connectWithApiKey(this.config as ConnectionWithCredentials)
      : this.connectWithCredentials(this.config as ConnectionWithCredentials));

    if (!result) {
      throw new OdooError('Authentication failed. Please check your credentials.');
    }

    if (isCredentialsResponse(result)) {
      this.auth_response = result;
    } else {
      this.auth_response = result;
      this.uid = result.uid;
    }
    this.is_connected = true;
    return this.auth_response;
  }
  //Checks the API key against the JSON-2 API (it has no login step: every request carries the key).
  private async connectWithJson2(): Promise<OdooAuthenticateWithApiKeyResponse> {
    const context = await this.json2Request<{ uid?: number }>('res.users', 'context_get', {});
    if (!context?.uid) {
      throw new OdooError('Odoo did not return the user of the API key.', { model: 'res.users', method: 'context_get' });
    }
    this.uid = context.uid;
    return { uid: context.uid };
  }
  //Connects to the Odoo server using an API key.
  private async connectWithApiKey(config: ConnectionWithCredentials): Promise<OdooAuthenticateWithApiKeyResponse> {
    const result = await this.jsonRpcRequest(`${this.url}/jsonrpc`, {
      service: 'common',
      method: 'authenticate',
      args: [config.db, config.username, config.apiKey, {}],
    });
    // A rejected login is not an error for Odoo: `authenticate` just answers `false`.
    if (typeof result !== 'number' || !result) {
      throw new OdooError('Odoo rejected the login: check username, apiKey and db.', { status: 401 });
    }
    this.uid = result;
    return { uid: result };
  }
  //Connects to the Odoo server using username and password credentials.
  private async connectWithCredentials(config: ConnectionWithCredentials): Promise<OdooAuthenticateWithCredentialsResponse> {
    const { result, response } = await this.jsonRpcExchange(`${this.url}/web/session/authenticate`, {
      db: config.db,
      login: config.username,
      password: config.password,
    });
    if (!result?.uid) {
      throw new OdooError('Odoo rejected the login: check username, password and db.', { status: 401 });
    }
    const cookies = response.headers.get('set-cookie');
    if (!cookies) {
      throw new OdooError('Cookie not found in response headers, please check your credentials');
    }
    const sessionId = cookies.match(/session_id=([^;]+)/)?.[1];
    if (!sessionId) {
      throw new OdooError('session_id not found in cookies');
    }
    this.session_id = sessionId;
    this.auth_response = result;
    return result;
  }
  //Connects to the Odoo server using an existing session ID.
  private async connectWithSessionId(): Promise<OdooAuthenticateWithCredentialsResponse> {
    if (!this.session_id) {
      throw new OdooError('session_id not found. Please connect first.');
    }
    const result = await this.jsonRpcRequest(`${this.url}/web/session/get_session_info`, {}, this.sessionHeaders());
    this.auth_response = result;
    return result;
  }
  /**
   * Calls a method with positional arguments (`execute_kw` style). With `protocol: 'json2'` only
   * calls without positional arguments, or with just the ids (`[[1, 2]]`), can be translated:
   * use `call()` there.
   */
  async call_kw(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    if (this.protocol === 'json2') {
      const onlyIds = args.length === 1 && Array.isArray(args[0]) && args[0].every((id: unknown) => typeof id === 'number');
      if (args.length && !onlyIds) {
        throw new OdooError(`call_kw with positional arguments is not supported by JSON-2: use call('${model}', '${method}', { … }) with named parameters.`, {
          model,
          method,
        });
      }
      return this.call(model, method, { ...kwargs, ...(onlyIds ? { ids: args[0] } : {}) });
    }
    if (!this.is_connected) {
      this.auth_response = await this.connect();
    }
    if (!this.session_id && !this.uid) {
      this.is_connected = false;
      throw new OdooError('Please connect with credentials or api key first.');
    }
    if (this.session_id) {
      return this.callWithSessionId(model, method, args, kwargs);
    } else if (this.uid) {
      return this.callWithUid(model, method, args, kwargs);
    }
  }
  /**
   * Calls a method with named parameters, the way JSON-2 works: `ids`, `context` and the
   * method's own arguments (`domain`, `fields`, `vals`…). With `jsonrpc` it becomes an
   * `execute_kw` with the ids as the only positional argument; parameter names follow the
   * running Odoo version (e.g. `search` takes `args`, not `domain`, before Odoo 17).
   */
  async call<T = any>(model: string, method: string, params: OdooCallParams = {}): Promise<T> {
    if (this.protocol === 'json2') {
      if (!this.is_connected) {
        await this.connect();
      }
      return this.json2Request<T>(model, method, params);
    }
    const { ids, ...kwargs } = params;
    return this.call_kw(model, method, ids ? [ids] : [], kwargs);
  }
  //Calls a method on the Odoo server using UID and API key authentication.
  private async callWithUid(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    return this.jsonRpcRequest(
      `${this.url}/jsonrpc`,
      {
        service: 'object',
        method: 'execute_kw',
        args: [this.config.db, this.uid, this.api_key, model, method, args, kwargs],
      },
      {},
      { model, method }
    );
  }
  //Calls a method on the Odoo server using session ID authentication.
  private async callWithSessionId(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    return this.jsonRpcRequest(`${this.url}/web/dataset/call_kw`, { model, method, args, kwargs }, this.sessionHeaders(), { model, method });
  }
  //Runs a helper with the arguments each protocol expects: positional for jsonrpc, named for json2.
  private invoke(model: string, method: string, positional: { args: any[]; kwargs?: any }, named: OdooCallParams): Promise<any> {
    return this.protocol === 'json2' ? this.call(model, method, named) : this.call_kw(model, method, positional.args, positional.kwargs);
  }
  //Creates a new record in the specified Odoo model (a list of values creates several and returns their ids).
  async create(model: string, values: any): Promise<number> {
    const result = await this.invoke(model, 'create', { args: [values] }, { vals_list: Array.isArray(values) ? values : [values] });
    return Array.isArray(values) || !Array.isArray(result) ? result : result[0];
  }
  //Reads records from the specified Odoo model.
  async read<T>(model: string, id: number | number[], fields: string[]): Promise<T[]> {
    return this.invoke(model, 'read', { args: [id, fields] }, { ids: Array.isArray(id) ? id : [id], fields });
  }
  //Updates a record in the specified Odoo model.
  async update(model: string, id: number, values: any): Promise<boolean> {
    return this.invoke(model, 'write', { args: [[id], values] }, { ids: [id], vals: values });
  }
  /**
   * Updates the translations for a field in the specified Odoo model.
   * @param model Model to update eg. product.template
   * @param id Id of the model to update
   * @param field field to update eg. name
   * @param translations object with translations eg. {de_DE: "Neuer Name", en_GB: "Name"}
   */
  async updateFieldTranslations(model: string, id: number, field: string, translations: { [key: string]: string }): Promise<boolean> {
    return this.invoke(
      model,
      'update_field_translations',
      { args: [[id], field, translations] },
      { ids: [id], field_name: field, translations }
    );
  }
  //Deletes a record from the specified Odoo model.
  async delete(model: string, id: number): Promise<boolean> {
    return this.invoke(model, 'unlink', { args: [[id]] }, { ids: [id] });
  }
  //Searches and reads records from the specified Odoo model.
  async searchRead<T>(model: string, domain: OdooSearchDomain, fields: string[], opts?: OdooSearchReadOptions): Promise<T[]> {
    const { context, ...paging } = opts ?? {};
    return (
      (await this.invoke(
        model,
        'search_read',
        { args: [domain, fields], kwargs: opts },
        { domain, fields, ...paging, ...(context ? { context } : {}) }
      )) || []
    );
  }
  //Searches for records in the specified Odoo model.
  async search(model: string, domain: OdooSearchDomain): Promise<number[]> {
    return (await this.invoke(model, 'search', { args: [domain] }, { domain })) || [];
  }
  //Retrieves the fields information for the specified Odoo model.
  async getFields(model: string): Promise<any> {
    return this.invoke(model, 'fields_get', { args: [] }, {});
  }
  //Executes an action (a button method) on the specified Odoo model for given record IDs.
  async action(model: string, action: string, ids: number[]): Promise<boolean> {
    return this.invoke(model, action, { args: [ids] }, { ids });
  }
  //Creates an external ID for a record in the specified Odoo model.
  async createExternalId(model: string, recordId: number, externalId: string, moduleName?: string): Promise<number> {
    const values = {
      model: model,
      name: `${externalId}`,
      res_id: recordId,
      module: moduleName || '__api__',
    };
    const result = await this.invoke('ir.model.data', 'create', { args: [[values]] }, { vals_list: [values] });
    return Array.isArray(result) ? result[0] : result;
  }
  //Searches for a record by its external ID.
  async searchByExternalId(externalId: string): Promise<number> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id']);
    if (!irModelData.length) {
      throw new OdooError(`No matching record found for external identifier ${externalId}`);
    }
    return irModelData[0]['res_id'];
  }
  //Reads a record by its external ID.
  async readByExternalId<T>(externalId: string, fields: string[] = []): Promise<T> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new OdooError(`No matching record found for external identifier ${externalId}`);
    }
    return (await this.read<any>(irModelData[0].model, [irModelData[0].res_id], fields))[0];
  }
  //Updates a record by its external ID.
  async updateByExternalId(externalId: string, params: any = {}): Promise<any> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new OdooError(`No matching record found for external identifier ${externalId}`);
    }
    return await this.update(irModelData[0].model, irModelData[0].res_id, params);
  }
  //Deletes a record by its external ID.
  async deleteByExternalId(externalId: string): Promise<any> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new OdooError(`No matching record found for external ID ${externalId}`);
    }
    return await this.delete(irModelData[0].model, irModelData[0].res_id);
  }
  //Disconnects from the Odoo server. API keys have no server session: only the local state is cleared.
  async disconnect(): Promise<boolean> {
    if (this.session_id) {
      await this.jsonRpcRequest(`${this.url}/web/session/destroy`, {}, this.sessionHeaders());
    } else if (!this.api_key) {
      throw new OdooError('session_id not found. Please connect first.');
    }
    this.is_connected = false;
    this.auth_response = undefined;
    this.uid = undefined;
    this.session_id = undefined;
    return true;
  }

  private sessionHeaders(): Record<string, string> {
    return {
      'X-Openerp-Session-Id': this.session_id!,
      Cookie: `session_id=${this.session_id}`,
    };
  }
  //POST with the configured timeout; every failure becomes an OdooError.
  private async post(endpoint: string, body: unknown, headers: Record<string, string>, ctx: RequestContext): Promise<Response> {
    const timeoutMs = this.config.timeoutMs;
    const [response, error] = await Try(() =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      })
    );
    if (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      throw new OdooError(timedOut ? `Odoo did not answer within ${timeoutMs} ms` : `Request to Odoo failed: ${error.message}`, { ...ctx, cause: error });
    }
    return response;
  }
  private async readJson(response: Response, ctx: RequestContext): Promise<any> {
    const [text, error] = await Try(() => response.text());
    if (error) {
      throw new OdooError(`Could not read Odoo's response: ${error.message}`, { ...ctx, status: response.status, cause: error });
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      const message = response.ok ? 'Odoo answered with something that is not JSON' : `HTTP ${response.status} ${response.statusText}`.trim();
      throw new OdooError(`${message}: ${text.slice(0, 200)}`, { ...ctx, status: response.status });
    }
  }
  //JSON-RPC envelope: `{ result }` or `{ error }`, usually with HTTP 200.
  private async jsonRpcExchange(endpoint: string, params: unknown, headers: Record<string, string> = {}, ctx: RequestContext = {}) {
    const response = await this.post(endpoint, { jsonrpc: '2.0', method: 'call', params, id: Date.now() }, headers, ctx);
    const body = await this.readJson(response, ctx);
    if (body?.error) {
      const { error } = body;
      throw new OdooError(error.data?.message || error.message || 'Odoo returned an error', {
        ...ctx,
        status: response.status,
        exceptionName: error.data?.name,
        data: error.data,
      });
    }
    if (!response.ok) {
      throw new OdooError(`HTTP ${response.status} ${response.statusText}`.trim(), { ...ctx, status: response.status });
    }
    return { result: body?.result, response };
  }
  private async jsonRpcRequest(endpoint: string, params: unknown, headers: Record<string, string> = {}, ctx: RequestContext = {}): Promise<any> {
    return (await this.jsonRpcExchange(endpoint, params, headers, ctx)).result;
  }
  //JSON-2: the body is the result; errors come with their HTTP status and `{ name, message, … }`.
  private async json2Request<T>(model: string, method: string, params: OdooCallParams): Promise<T> {
    const ctx = { model, method };
    const headers: Record<string, string> = { Authorization: `bearer ${this.api_key}` };
    if (this.config.db) {
      headers['X-Odoo-Database'] = this.config.db;
    }
    const response = await this.post(`${this.url}/json/2/${model}/${method}`, params, headers, ctx);
    const body = await this.readJson(response, ctx);
    if (!response.ok) {
      const message = body?.message || `HTTP ${response.status} ${response.statusText}`.trim();
      throw new OdooError(response.status === 401 ? `Odoo rejected the API key: ${message}` : message, {
        ...ctx,
        status: response.status,
        exceptionName: body?.name,
        data: body,
      });
    }
    return body as T;
  }
}
