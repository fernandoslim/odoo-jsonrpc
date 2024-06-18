type OdooSearchDomain = any | any[];

interface OdooSearchReadOptions {
  offset?: number;
  limit?: number;
  order?: string;
  context?: any;
}
export interface OdooAuthenticateResponse {
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
}

export interface UserContext {
  lang: string;
  tz: string;
  uid: number;
}

export interface UserSettings {
  id: number;
  user_id: UserId;
  is_discuss_sidebar_category_channel_open: boolean;
  is_discuss_sidebar_category_chat_open: boolean;
  push_to_talk_key: boolean;
  use_push_to_talk: boolean;
  voice_active_duration: number;
  volume_settings_ids: [string, any[]][];
  homemenu_config: boolean;
}

export interface UserId {
  id: number;
}
interface OdooConnectionBase {
  baseUrl: string;
  port: number;
  db: string;
}

interface ConnectionWithSession extends OdooConnectionBase {
  sessionId: string;
}

interface ConnectionWithCredentials extends OdooConnectionBase {
  username: string;
  password: string;
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
export default class OdooJSONRpc {
  private session_id: string = '';
  private url: string;
  private auth_response: any;

  constructor(private config: OdooConnection) {
    this.url = `${this.config.baseUrl}:${this.config.port}`;
    if ('sessionId' in this.config) {
      this.session_id = this.config.sessionId;
    }
  }
  get authResponse(): OdooAuthenticateResponse {
    return this.auth_response;
  }
  async call_kw(model: string, method: string, args: any[], kwargs: any = {}) {
    if (!this.session_id) {
      throw new Error('session_id not found. Please connect first.');
    }
    const endpoint = `${this.url}/web/dataset/call_kw`;
    const data = {
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
    };
    const [response, request_error] = await Try(() =>
      fetch(endpoint, {
        headers,
        method: 'POST',
        body: JSON.stringify(data),
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
  async connect(): Promise<OdooAuthenticateResponse> {
    if ('sessionId' in this.config) {
      const endpoint = `${this.url}/web/session/get_session_info`;
      const data = {
        jsonrpc: '2.0',
        method: 'call',
        params: {},
        id: new Date().getTime(),
      };
      const [response, auth_error] = await Try(() =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Openerp-Session-Id': this.session_id,
          },
          body: JSON.stringify(data),
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
    } else {
      const endpoint = `${this.url}/web/session/authenticate`;
      const data = {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          db: this.config.db,
          login: this.config.username,
          password: this.config.password,
        },
        id: new Date().getTime(),
      };
      const [response, auth_error] = await Try(() =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Openerp-Session-Id': this.session_id,
          },
          body: JSON.stringify(data),
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
  async updateByExternalId(externalId: string, params: any = {}) {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external identifier ${externalId}`);
    }
    return await this.update(irModelData[0].model, irModelData[0].res_id, params);
  }
  async deleteByExternalId(externalId: string) {
    const irModelData = await this.searchRead<any>('ir.model.data', [['name', '=', externalId]], ['res_id', 'model']);
    if (!irModelData.length) {
      throw new Error(`No matching record found for external ID ${externalId}`);
    }
    return await this.delete(irModelData[0].model, irModelData[0].res_id);
  }
}
