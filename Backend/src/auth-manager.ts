import { query } from './db.js';
import { getSecret, putSecret } from './vault.js';
import { checkDestination } from './security.js';

type Profile = { id: string; auth_type: string; scope_type: string; scope_id: string | null; config: Record<string, any>; secret_ref: string | null; enabled: boolean };
type Credentials = Record<string, any>;

async function profile(id: string): Promise<Profile> {
  const result = await query<Profile>('SELECT id,auth_type,scope_type,scope_id,config,secret_ref,enabled FROM auth_profiles WHERE id=$1', [id]);
  if (!result.rowCount || !result.rows[0]!.enabled) throw new Error('Authentication profile is unavailable');
  return result.rows[0]!;
}

export async function resolveAuthHeaders(profileId: string | null | undefined, agentId?: string, userId?:string): Promise<Record<string, string>> {
  if (!profileId) return {};
  const item = await profile(profileId);
  if (item.scope_type === 'agent' && item.scope_id !== agentId) throw new Error('Agent is not authorized to use this authentication profile');
  if (item.scope_type === 'user' && item.scope_id!==userId) throw new Error('User is not authorized to use this authentication profile');
  const secrets = item.secret_ref ? await getSecret<Credentials>(item.secret_ref) : {};
  switch (item.auth_type) {
    case 'none': case 'mcp': return {};
    case 'api_key': if(!secrets.apiKey)throw new Error('API key secret is missing');return { [String(item.config.headerName ?? 'x-api-key')]: String(secrets.apiKey) };
    case 'bearer': if(!secrets.token)throw new Error('Bearer token secret is missing');return { authorization: `Bearer ${String(secrets.token)}` };
    case 'basic': if(secrets.username===undefined||secrets.password===undefined)throw new Error('Basic authentication secret is incomplete');return { authorization: `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64')}` };
    case 'custom_headers': if(!secrets.headers||typeof secrets.headers!=='object')throw new Error('Custom header secret is missing');return secrets.headers;
    case 'oauth2': case 'client_credentials': return { authorization: `Bearer ${await getOAuthToken(item, secrets)}` };
    default: throw new Error('Unsupported authentication profile type');
  }
}

export async function resolveMcpCredentials(profileId: string | null | undefined): Promise<{ headers: Record<string,string>; env: Record<string,string> }> {
  if(!profileId) return {headers:{},env:{}};
  const item=await profile(profileId);
  if(item.scope_type!=='service') throw new Error('MCP server authentication profiles must use service scope');
  const secret=item.secret_ref?await getSecret<Credentials>(item.secret_ref):{};
  if(item.auth_type==='mcp')return {headers:secret.headers??{},env:secret.env??{}};
  if(item.auth_type==='oauth2'||item.auth_type==='client_credentials')return {headers:await resolveAuthHeaders(profileId),env:{}};
  if(item.auth_type==='custom_headers') return {headers:secret.headers??{},env:secret.env??{}};
  if(item.auth_type==='bearer') return {headers:{authorization:`Bearer ${secret.token??''}`},env:{}};
  if(item.auth_type==='basic') return {headers:{authorization:`Basic ${Buffer.from(`${secret.username??''}:${secret.password??''}`).toString('base64')}`},env:{}};
  if(item.auth_type==='api_key') return {headers:{[String(item.config.headerName??'x-api-key')]:String(secret.apiKey??'')},env:{}};
  return {headers:{},env:{}};
}

async function getOAuthToken(item: Profile, secret: Credentials): Promise<string> {
  const now = Date.now();
  if (secret.accessToken && Number(secret.expiresAt ?? 0) > now + 30000) return secret.accessToken as string;
  if(!secret.clientId||(!secret.clientSecret&&!secret.refreshToken))throw new Error('OAuth client credentials are incomplete');
  const tokenUrl = String(item.config.tokenUrl ?? '');
  if (!tokenUrl) throw new Error('OAuth profile is missing tokenUrl');
  const safeTokenUrl=await checkDestination(tokenUrl);
  const form = new URLSearchParams();
  if (secret.refreshToken) {
    form.set('grant_type', 'refresh_token'); form.set('refresh_token', String(secret.refreshToken));
    if (secret.clientId) form.set('client_id', String(secret.clientId));
    if (secret.clientSecret) form.set('client_secret', String(secret.clientSecret));
  } else {
    form.set('grant_type', 'client_credentials'); form.set('client_id', String(secret.clientId ?? '')); form.set('client_secret', String(secret.clientSecret ?? ''));
    if (item.config.scope) form.set('scope', String(item.config.scope));
    if (item.config.audience) form.set('audience', String(item.config.audience));
  }
  const tokenResponse = await fetch(safeTokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(item.config.tokenHeaders ?? {}) }, body: form, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const payload = await tokenResponse.json() as Record<string, any>;
  if (!tokenResponse.ok || typeof payload.access_token !== 'string') throw new Error(`OAuth token acquisition failed (HTTP ${tokenResponse.status})`);
  const nextSecret = { ...secret, accessToken: payload.access_token, expiresAt: now + Number(payload.expires_in ?? 3600) * 1000, refreshToken: payload.refresh_token ?? secret.refreshToken };
  if (item.secret_ref) await putSecret(nextSecret, item.secret_ref);
  await query('UPDATE auth_profiles SET last_validated_at=now(),last_validation_error=NULL WHERE id=$1', [item.id]);
  return payload.access_token;
}

export async function testProfile(profileId: string) {
  try { const item=await profile(profileId);await resolveAuthHeaders(profileId,item.scope_type==='agent'?item.scope_id??undefined:undefined,item.scope_type==='user'?item.scope_id??undefined:undefined); await query('UPDATE auth_profiles SET last_validated_at=now(),last_validation_error=NULL WHERE id=$1', [profileId]); return { valid: true }; }
  catch (error) { const message = String(await redactProfileSecrets(profileId,error instanceof Error?error.message:'Authentication validation failed')); await query('UPDATE auth_profiles SET last_validation_error=$2 WHERE id=$1', [profileId,message]); throw new Error(message); }
}

export async function redactProfileSecrets(profileId:string|null|undefined,value:unknown):Promise<unknown>{
  if(!profileId)return value;const item=await query<{secret_ref:string|null}>('SELECT secret_ref FROM auth_profiles WHERE id=$1',[profileId]);if(!item.rowCount||!item.rows[0]!.secret_ref)return value;const secret=await getSecret<Credentials>(item.rows[0]!.secret_ref!);const hidden:string[]=[];const walk=(node:unknown)=>{if(typeof node==='string'){if(node.length)hidden.push(node);return;}if(Array.isArray(node)){node.forEach(walk);return;}if(node&&typeof node==='object')Object.values(node).forEach(walk);};walk(secret);
  const serialized=JSON.stringify(value);if(serialized===undefined)return value;let redacted=serialized;for(const hiddenValue of new Set(hidden))redacted=redacted.split(hiddenValue).join('[REDACTED]');return JSON.parse(redacted);
}
