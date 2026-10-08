import { describe, expect, it } from 'vitest';
import OdooJSONRpc, { OdooError, type OdooConnection } from '../src';

/**
 * Read-only checks against a real Odoo. Skipped unless ODOO_LIVE_URL, ODOO_LIVE_DB and
 * ODOO_LIVE_USER are set, plus at least one credential:
 *   ODOO_LIVE_KEY       API key: JSON-RPC, and JSON-2 on Odoo 19+ (ODOO_LIVE_JSON2=0 to skip it)
 *   ODOO_LIVE_PASSWORD  password: JSON-RPC with a session (/web/session/*)
 * Nothing is written: only searches, reads, fields_get and the session it opens and closes.
 */
const { ODOO_LIVE_URL, ODOO_LIVE_DB, ODOO_LIVE_USER, ODOO_LIVE_KEY, ODOO_LIVE_PASSWORD, ODOO_LIVE_JSON2 } = process.env;
const base = { baseUrl: ODOO_LIVE_URL, db: ODOO_LIVE_DB, timeoutMs: 30_000 };

const modes: [string, OdooConnection][] = [];
if (ODOO_LIVE_KEY) {
  modes.push(['jsonrpc · API key', { ...base, username: ODOO_LIVE_USER, apiKey: ODOO_LIVE_KEY }]);
  if (ODOO_LIVE_JSON2 !== '0') modes.push(['json2 · API key', { ...base, apiKey: ODOO_LIVE_KEY, protocol: 'json2' }]);
}
if (ODOO_LIVE_PASSWORD) modes.push(['jsonrpc · password', { ...base, username: ODOO_LIVE_USER, password: ODOO_LIVE_PASSWORD }]);
const enabled = Boolean(ODOO_LIVE_URL && ODOO_LIVE_DB && ODOO_LIVE_USER && modes.length);

describe.skipIf(!enabled)('live Odoo (read-only)', () => {
  for (const [label, config] of modes) {
    describe(label, () => {
      it('connects and reads', async () => {
        const odoo = new OdooJSONRpc(config);
        const auth = await odoo.connect();
        expect(auth.uid).toBeGreaterThan(0);

        const companies = await odoo.searchRead<{ id: number; name: string }>('res.company', [], ['name'], { limit: 1 });
        expect(companies[0]?.name).toBeTruthy();

        const fields = await odoo.getFields('res.partner');
        expect(fields).toHaveProperty('email');

        const ids = await odoo.search('res.country', [['code', '=', 'US']]);
        expect(ids).toHaveLength(1);
        const [us] = await odoo.read<{ name: string }>('res.country', ids[0], ['name']);
        expect(us.name).toBeTruthy();

        const count = await odoo.call('res.country', 'search_count', { domain: [] });
        expect(count).toBeGreaterThan(100);

        if (odoo.sessionId) await expect(odoo.disconnect()).resolves.toBe(true);
      });

      it('reports an unknown model as an OdooError', async () => {
        const odoo = new OdooJSONRpc(config);
        const error = await odoo.search('no.such.model', []).catch((e) => e);
        expect(error).toBeInstanceOf(OdooError);
        expect(error.model).toBe('no.such.model');
        if (odoo.sessionId) await odoo.disconnect();
      });
    });
  }

  it.skipIf(!ODOO_LIVE_PASSWORD)('reuses a session id', async () => {
    const first = new OdooJSONRpc({ ...base, username: ODOO_LIVE_USER, password: ODOO_LIVE_PASSWORD });
    await first.connect();
    const second = new OdooJSONRpc({ ...base, sessionId: first.sessionId });
    await expect(second.connect()).resolves.toMatchObject({ uid: first.uId });
    await expect(second.search('res.country', [['code', '=', 'US']])).resolves.toHaveLength(1);
    await first.disconnect();
  });
});
