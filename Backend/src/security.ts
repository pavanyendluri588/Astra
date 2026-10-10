import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { config } from './config.js';

export async function checkDestination(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('URL must be HTTP(S), without user information or fragments');
  const host = url.hostname.toLowerCase();
  for(const key of url.searchParams.keys())if(/(token|secret|password|api[_-]?key|authorization)/i.test(key))throw new Error('Credential values must use an authentication profile, not URL query parameters');
  if (config.outboundHostAllowlist.length && !config.outboundHostAllowlist.includes(host)) throw new Error('Host is not in OUTBOUND_HOST_ALLOWLIST');
  if (!config.outboundHostAllowlist.length) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local destinations are not allowed');
    const addresses = ipaddr.isValid(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
    if (!addresses.length || addresses.some((address) => !ipaddr.parse(address).range().includes('unicast'))) throw new Error('Destination must resolve to a public address');
  }
  return url;
}
