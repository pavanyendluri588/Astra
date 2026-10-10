import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) => pool.query<T>(text, values);

export async function audit(actor: string, action: string, entityType: string, entityId: string | null, details: unknown = {}) {
  await query('INSERT INTO audit_records (actor, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)', [actor, action, entityType, entityId, details]);
}
