import { query } from './db.js';
import { decrypt, encrypt } from './crypto.js';

export async function putSecret(value: unknown, id?: string): Promise<string> {
  if (id) {
    await query('UPDATE secret_vault SET ciphertext=$2,updated_at=now() WHERE id=$1', [id, encrypt(value)]);
    return id;
  }
  const result = await query('INSERT INTO secret_vault(ciphertext) VALUES($1) RETURNING id', [encrypt(value)]);
  return result.rows[0]!.id as string;
}

export async function getSecret<T>(id: string): Promise<T> {
  const result = await query<{ ciphertext: string }>('SELECT ciphertext FROM secret_vault WHERE id=$1', [id]);
  if (!result.rowCount) throw new Error('Credential secret reference is unavailable');
  return decrypt<T>(result.rows[0]!.ciphertext);
}

export async function deleteSecretIfUnreferenced(id: string) {
  await query('DELETE FROM secret_vault s WHERE s.id=$1 AND NOT EXISTS (SELECT 1 FROM auth_profiles p WHERE p.secret_ref=s.id)', [id]);
}
