import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}

export function decrypt<T>(value: string): T {
  const [iv, tag, body] = value.split('.');
  if (!iv || !tag || !body) throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString('utf8')) as T;
}

export function hashToken(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
