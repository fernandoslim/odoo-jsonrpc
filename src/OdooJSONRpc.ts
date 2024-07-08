type OdooSearchDomain = any | any[];

interface OdooSearchReadOptions {
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
type OdooConnectionBase = {
  baseUrl: string;
  port: number;
  db: string;
};

interface ConnectionWithSession extends OdooConnectionBase {
  sessionId: string;
}

interface ConnectionWithCredentials extends OdooConnectionBase {
  username: string;
  password?: string;
  apiKey?: string;
}

type OdooConnection = ConnectionWithSession | ConnectionWithCredentials;

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
  return 'username' in response;
};
export default class OdooJSONRpc {
  public url: string;

  private session_id: string | undefined;
  private auth_response: any;
  private uid: number | undefined = undefined;
  private api_key: string | undefined = undefined;

  constructor(private config: OdooConnection) {
    this.url = `${this.config.baseUrl}:${this.config.port}`;
    if ('sessionId' in this.config) {
      this.session_id = this.config.sessionId;
    } else if ('apiKey' in this.config) {
      this.api_key = this.config.apiKey;
    }
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
  get port(): number {
    return this.config.port;
  }
  async call_kw(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    if (!this.session_id && !this.uid) {
      throw new Error('Please connect with credentials or api key first.');
    }
    if (this.session_id) {
      return this.callWithSessionId(model, method, args, kwargs);
    } else if (this.uid) {
      return this.callWithUid(model, method, args, kwargs);
    }
  }
  private async callWithUid(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    const endpoint = `${this.url}/jsonrpc`;
    const params = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [this.config.db, this.uid, this.api_key, model, method, args, kwargs],
      },
      id: new Date().getTime(),
    };
    const headers = {
      'Content-Type': 'application/json',
    };
    const [response, request_error] = await Try(() =>
      fetch(endpoint, {
        headers,
        method: 'POST',
        body: JSON.stringify(params),
      })
    );
    if (request_error) {
      throw request_error;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const [body, body_parse_error] = await Try(() => response.json());
    if (body_parse_error) {
      throw body_parse_error;
    }
    const { result, error } = body;
    if (error) {
      throw new Error(body?.error?.data?.message);
    }
    return result;
  }
  private async callWithSessionId(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
    const endpoint = `${this.url}/web/dataset/call_kw`;
    const params = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        model,
        method,
        args,
        kwargs,
      },
      id: new Date().getTime(),
    };
    const headers: any = {
      'Content-Type': 'application/json',
      'X-Openerp-Session-Id': this.session_id,
      Cookie: `session_id=${this.session_id}`,
    };
    const [response, request_error] = await Try(() =>
      fetch(endpoint, {
        headers,
        method: 'POST',
        body: JSON.stringify(params),
      })
    );
    if (request_error) {
      throw request_error;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const [body, body_parse_error] = await Try(() => response.json());
    if (body_parse_error) {
      throw body_parse_error;
    }
    const { result, error } = body;
    if (error) {
      throw new Error(body?.error?.data?.message);
    }
    return result;
  }
  async connect(): Promise<OdooAuthenticateWithCredentialsResponse | OdooAuthenticateWithApiKeyResponse> {
    const result = await ('sessionId' in this.config
      ? this.connectWithSessionId()
      : 'apiKey' in this.config
      ? this.connectWithApiKey(this.config as ConnectionWithCredentials)
      : this.connectWithCredentials(this.config as ConnectionWithCredentials));

    if (this.isCredentialsResponse(result)) {
      this.auth_response = result;
    } else {
      this.uid = result.uid;
    }

    return result;
  }
  private isCredentialsResponse(
    response: OdooAuthenticateWithCredentialsResponse | OdooAuthenticateWithApiKeyResponse
  ): response is OdooAuthenticateWithCredentialsResponse {
    return 'username' in response;
  }
  private async connectWithApiKey(config: ConnectionWithCredentials): Promise<OdooAuthenticateWithApiKeyResponse> {
    const endpoint = `${this.url}/jsonrpc`;
    const params = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'common',
        method: 'authenticate',
        args: [config.db, config.username, config.apiKey, {}],
      },
      id: new Date().getTime(),
    };
    const [response, auth_error] = await Try(() =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      })
    );
    if (auth_error) {
      throw auth_error;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const [body, body_parse_error] = await Try(() => response.json());
    if (body_parse_error) {
      throw body_parse_error;
    }
    const { result, odoo_error } = body;
    if (odoo_error) {
      throw new Error(body?.error?.data?.message);
    }
    this.uid = result;
    return { uid: result };
  }
  private async connectWithCredentials(config: ConnectionWithCredentials): Promise<OdooAuthenticateWithCredentialsResponse> {
    const endpoint = `${this.url}/web/session/authenticate`;
    const params = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: config.db,
        login: config.username,
        password: config.password,
      },
      id: new Date().getTime(),
    };
    const [response, auth_error] = await Try(() =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      })
    );
    if (auth_error) {
      throw auth_error;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const [body, body_parse_error] = await Try(() => response.json());
    if (body_parse_error) {
      throw body_parse_error;
    }
    const { result, odoo_error } = body;
    if (odoo_error) {
      throw new Error(body?.error?.data?.message);
    }
    const cookies = response.headers.get('set-cookie');
    if (!cookies) {
      throw new Error('Cookie not found in response headers, please check your credentials');
    }
    if (!cookies.includes('session_id')) {
      throw new Error('session_id not found in cookies');
    }
    const sessionId = cookies
      .split(';')
      .find((cookie) => cookie.includes('session_id'))!
      .split('=')[1];
    this.session_id = sessionId;
    this.auth_response = result;
    return result;
  }
  private async connectWithSessionId(): Promise<OdooAuthenticateWithCredentialsResponse> {
    const endpoint = `${this.url}/web/session/get_session_info`;
    const params = {
      jsonrpc: '2.0',
      method: 'call',
      params: {},
      id: new Date().getTime(),
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.session_id) {
      headers['X-Openerp-Session-Id'] = this.session_id;
      headers['Cookie'] = `session_id=${this.session_id}`;
    } else {
      throw new Error('session_id not found. Please connect first.');
    }
    const [response, auth_error] = await Try(() =>
      fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })
    );
    if (auth_error) {
      throw auth_error;
    }
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const [body, body_parse_error] = await Try(() => response.json());
    if (body_parse_error) {
      throw body_parse_error;
    }
    const { result, odoo_error } = body;
    if (odoo_error) {
      throw new Error(body?.error?.data?.message);
    }
    this.auth_response = result;
    return result;
  }
  async create(model: string, values: any): Promise<number> {
    return this.call_kw(model, 'create', [values]);
  }
  async read<T>(model: string, id: number | number[], fields: string[]): Promise<T[]> {
    return this.call_kw(model, 'read', [id, fields]);
  }
  async update(model: string, id: number, values: any): Promise<boolean> {
    return this.call_kw(model, 'write', [[id], values]);
  }
  async delete(model: string, id: number): Promise<boolean> {
    return this.call_kw(model, 'unlink', [[id]]);
  }
  async searchRead<T>(model: string, domain: OdooSearchDomain, fields: string[], opts?: OdooSearchReadOptions): Promise<T[]> {
    return (await this.call_kw(model, 'search_read', [domain, fields], opts)) || [];
  }

  async search(model: string, domain: OdooSearchDomain): Promise<number[]> {
    return (await this.call_kw(model, 'search', [domain])) || [];
  }
  async getFields(model: string): Promise<any> {
    return this.call_kw(model, 'fields_get', []);
  }
  async action(model: string, action: string, ids: number[]): Promise<boolean> {
    return this.call_kw(model, action, ids);
  }
  async createExternalId(model: string, recordId: number, externalId: string, moduleName?: string): Promise<number> {
    return await this.call_kw('ir.model.data', 'create', [
      [
        {
          model: model,
          name: `${externalId}`,
          res_id: recordId,
          module: moduleName || '__api__',
        },
      ],
    ]);
  }
  async searchByExternalId(externalId: string): Promise<number> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external identifier ${externalId}`);
    }
    return irModelData[0]['res_id'];
  }
  async readByExternalId<T>(externalId: string, fields: string[] = []): Promise<T> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external identifier ${externalId}`);
    }
    return (await this.read<any>(irModelData[0].model, [irModelData[0].res_id], fields))[0];
  }
  async updateByExternalId(externalId: string, params: any = {}): Promise<any> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external identifier ${externalId}`);
    }
    return await this.update(irModelData[0].model, irModelData[0].res_id, params);
  }
  async deleteByExternalId(externalId: string): Promise<any> {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external ID ${externalId}`);
    }
    return await this.delete(irModelData[0].model, irModelData[0].res_id);
  }
}
