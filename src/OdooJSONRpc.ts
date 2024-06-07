type OdooSearchDomain = any | any[];

interface OdooSearchReadOptions {
  offset?: number;
  limit?: number;
  order?: string;
  context?: any;
}
export default class OdooJSONRpc {
  private session_id: string = '';
  private url: string;
  private db: string;
  private username: string;
  private password: string;

  constructor({ baseUrl, port, db, username, password }: { baseUrl: string; port: number; db: string; username: string; password: string }) {
    this.url = `${baseUrl}:${port}`;
    this.db = db;
    this.username = username;
    this.password = password;
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
    const response = await fetch(endpoint, {
      headers,
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const body = await response.json();
    const { result, error } = body;
    if (error) {
      throw new Error(body.error.data.message);
    }
    return result;
  }
  async connect() {
    if (this.session_id) {
      return;
    }
    const endpoint = `${this.url}/web/session/authenticate`;
    const data = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: this.db,
        login: this.username,
        password: this.password,
      },
      id: new Date().getTime(),
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Openerp-Session-Id': this.session_id,
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const cookies = response.headers.get('set-cookie');
    if (!cookies) {
      throw new Error('Cookie not found in response headers');
    }
    if (!cookies.includes('session_id')) {
      throw new Error('session_id not found in cookies');
    }
    const sessionId = cookies
      .split(';')
      .find((cookie) => cookie.includes('session_id'))!
      .split('=')[1];
    this.session_id = sessionId;
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
