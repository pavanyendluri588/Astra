import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';
import { decrypt, encrypt } from './crypto.js';

async function migrateLegacySecrets() {
  const legacyServerColumn = await query("SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='connection_encrypted'");
  const servers = legacyServerColumn.rowCount ? await query<{ id: string; connection_encrypted: string }>('SELECT id,connection_encrypted FROM mcp_servers WHERE connection_encrypted IS NOT NULL') : { rows: [] as {id:string;connection_encrypted:string}[] };
  for (const server of servers.rows) {
    const connection = decrypt<{ url: string; headers?: Record<string, string>; tags?: string[] }>(server.connection_encrypted);
    let profileId: string | null = null;
    if (connection.headers && Object.keys(connection.headers).length) {
      const name = `legacy-mcp-${server.id}`;
      const vault = await query('INSERT INTO secret_vault(ciphertext) VALUES($1) RETURNING id', [encrypt({ headers: connection.headers })]);
      const profile = await query('INSERT INTO auth_profiles(name,auth_type,config,secret_ref) VALUES($1,\'custom_headers\',$2,$3) ON CONFLICT(name) DO UPDATE SET secret_ref=EXCLUDED.secret_ref RETURNING id', [name,{headerNames:Object.keys(connection.headers)},vault.rows[0]!.id]);
      profileId = profile.rows[0]!.id as string;
    }
    await query('UPDATE mcp_servers SET connection_spec=$2,auth_profile_id=COALESCE(auth_profile_id,$3) WHERE id=$1', [server.id,{url:connection.url,tags:connection.tags??[]},profileId]);
  }
  const legacyToolColumns = await query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='tools' AND column_name IN ('headers_encrypted','auth_encrypted')");
  const tools = legacyToolColumns.rows[0]!.count === 2 ? await query<{ id: string; headers_encrypted: string | null; auth_encrypted: string | null }>('SELECT id,headers_encrypted,auth_encrypted FROM tools WHERE headers_encrypted IS NOT NULL OR auth_encrypted IS NOT NULL') : { rows: [] as {id:string;headers_encrypted:string|null;auth_encrypted:string|null}[] };
  for (const tool of tools.rows) {
    const headers = tool.headers_encrypted ? decrypt<Record<string,string>>(tool.headers_encrypted) : {};
    const auth = tool.auth_encrypted ? decrypt<any>(tool.auth_encrypted) : {type:'none'};
    if(auth.type==='bearer') headers.authorization=`Bearer ${auth.token}`;
    if(auth.type==='basic') headers.authorization=`Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    if(auth.type==='header') headers[auth.name]=auth.value;
    const vault = await query('INSERT INTO secret_vault(ciphertext) VALUES($1) RETURNING id', [encrypt({headers})]);
    const profile = await query('INSERT INTO auth_profiles(name,auth_type,config,secret_ref) VALUES($1,\'custom_headers\',$2,$3) ON CONFLICT(name) DO UPDATE SET secret_ref=EXCLUDED.secret_ref RETURNING id', [`legacy-tool-${tool.id}`,{headerNames:Object.keys(headers)},vault.rows[0]!.id]);
    await query('UPDATE tools SET auth_profile_id=COALESCE(auth_profile_id,$2) WHERE id=$1',[tool.id,profile.rows[0]!.id]);
  }
  await query('ALTER TABLE tools DROP COLUMN IF EXISTS headers_encrypted, DROP COLUMN IF EXISTS auth_encrypted');
  await query('ALTER TABLE mcp_servers DROP COLUMN IF EXISTS connection_encrypted');
}

try {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of ['001_initial.sql','002_universal_catalog.sql']) {
    const found = await query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
    if (found.rowCount) continue;
    const path = fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(await readFile(path,'utf8')); await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]); await client.query('COMMIT'); }
    catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  await migrateLegacySecrets();
  console.log('Database schema is up to date.');
} finally { await pool.end(); }
