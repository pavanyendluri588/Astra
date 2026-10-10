import 'dotenv/config';

const key = process.env.ENCRYPTION_KEY ?? '';
if (key && !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters');

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://registry:registry@localhost:5432/tool_registry',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  adminToken: process.env.REGISTRY_ADMIN_TOKEN ?? '',
  encryptionKey: key,
  outboundHostAllowlist: (process.env.OUTBOUND_HOST_ALLOWLIST ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
  mcpStdioEnabled: process.env.MCP_STDIO_ENABLED === 'true',
  mcpStdioDockerBin:process.env.MCP_STDIO_DOCKER_BIN??'docker',
  mcpStdioImageAllowlist: (process.env.MCP_STDIO_IMAGE_ALLOWLIST ?? '').split(',').map((image) => image.trim().toLowerCase()).filter(Boolean),
  mcpSyncIntervalMs:Math.max(30000,Number(process.env.MCP_SYNC_INTERVAL_MS??300000)),
};

if (!config.adminToken) throw new Error('REGISTRY_ADMIN_TOKEN must be set');
if (!config.encryptionKey) throw new Error('ENCRYPTION_KEY must be set');
