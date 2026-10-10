import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool, query } from './db.js';
import { registerRoutes, synchronizeServer } from './registry.js';

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Agent-Id', 'X-User-Id', 'X-Approval-Id'],
});
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues });
  app.log.error(error);
  return reply.code(500).send({ error: 'Internal server error' });
});
await registerRoutes(app);
let syncing=false;
const syncTimer=setInterval(async()=>{if(syncing)return;syncing=true;try{const servers=await query<{id:string}>('SELECT id FROM mcp_servers WHERE status<>\'disabled\'');for(const server of servers.rows){try{await synchronizeServer(server.id,'scheduler');}catch(error){app.log.warn({serverId:server.id,error:'MCP background sync failed'});}}}catch(error){app.log.error({error:'MCP scheduler failed'});}finally{syncing=false;}},config.mcpSyncIntervalMs);
syncTimer.unref();

const close = async () => { clearInterval(syncTimer);await app.close(); await pool.end(); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
try {
  await pool.query('SELECT 1');
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
