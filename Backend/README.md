# Universal Tool Catalog API

PostgreSQL-backed tool catalog, authentication manager, and execution gateway. The catalog supports exactly two registration types: MCP servers (STDIO, Streamable HTTP, or SSE) and standalone HTTP APIs.

## Run locally

1. Copy `.env.example` to `.env`. Set a long `REGISTRY_ADMIN_TOKEN` and a random 32-byte `ENCRYPTION_KEY` (64 hex characters).
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `npm install`, then `npm run db:migrate`.
4. Start with `npm run dev` (or `npm run build` and `npm start`).

Admin routes require `Authorization: Bearer $REGISTRY_ADMIN_TOKEN`. Agent routes require an agent token and `X-Agent-Id`; use `X-User-Id` only after assigning that user scope to the agent. Agent tokens are returned once at creation or rotation.

Credentials go into the encrypted `secret_vault` table, separate from tool and auth-profile metadata. PostgreSQL tool definitions store only auth-profile references. AES-256-GCM uses `ENCRYPTION_KEY`; changing that key without migrating vault values makes stored credentials unreadable. Secrets are omitted from API definitions, audit details, execution logs, errors, and returned tool results.

STDIO MCP runs inside Docker with no network, read-only root filesystem, no host mounts, dropped Linux capabilities, no-new-privileges, and CPU/memory/process limits. It is disabled by default. Enable it with `MCP_STDIO_ENABLED=true` and list exact approved images in `MCP_STDIO_IMAGE_ALLOWLIST`. The Docker CLI/daemon must be available. Arguments containing credential-like values are rejected; provide runtime environment credentials in an MCP authentication profile.

HTTP destinations and OAuth token URLs must use HTTP(S), contain no embedded user info or credential query parameters, and resolve to public addresses. `OUTBOUND_HOST_ALLOWLIST` optionally narrows hosts further. Redirects are disabled.

## Catalog and registrations

| Method | Route | Use |
| --- | --- | --- |
| `GET` | `/v1/tools?search=&registrationType=http&tags=API,Files&capabilities=&owner=&provider=` | Admin search by name, description, tags, capabilities, owner, provider, type, and enabled state |
| `POST` | `/v1/tools` | Register a standalone HTTP API |
| `GET`, `PATCH`, `DELETE` | `/v1/tools/:id` | Inspect, edit, enable/disable, deprecate, or delete |
| `POST` | `/v1/tools/:id/test` | Validate input and test an HTTP endpoint |
| `GET` | `/v1/tools/:id/versions` | List versions and breaking schema changes |
| `POST` | `/v1/tools/:id/versions/:version/rollback` | Roll back a standalone API definition |
| `GET`, `POST`, `DELETE` | `/v1/tags` | List built-in tags, create/update custom tags, or delete custom tags |

Standalone tool example:

```json
{
  "name": "Search inventory",
  "description": "Find products by SKU",
  "url": "https://inventory.example.com/items/{sku}",
  "method": "GET",
  "authProfileId": "00000000-0000-4000-8000-000000000001",
  "pathSchema": { "type": "object", "properties": { "sku": { "type": "string" } }, "required": ["sku"] },
  "querySchema": { "type": "object", "properties": { "includeStock": { "type": "boolean" } } },
  "requestSchema": {},
  "responseSchema": { "type": "object" },
  "timeoutMs": 8000,
  "retryConfig": { "maxRetries": 2, "backoffMs": 250 },
  "rateLimit": { "maxRequests": 60, "windowSeconds": 60 },
  "capabilities": ["inventory-search"],
  "owner": "supply-chain",
  "provider": "inventory-service",
  "tags": ["Database", "Custom"]
}
```

For an inline one-off auth configuration, registration also accepts `headers` and `authentication` (`none`, `bearer`, `basic`, or custom `header`). Values are moved to the encrypted vault. Reusable profiles are preferred.

## Authentication profiles

| Method | Route | Use |
| --- | --- | --- |
| `GET`, `POST`, `PATCH`, `DELETE` | `/v1/auth-profiles` | Manage reusable no-auth, API key, basic, bearer, OAuth 2.0/client credentials, custom-header, or MCP profiles |
| `POST` | `/v1/auth-profiles/:id/test` | Validate stored credentials or acquire/refresh an OAuth token |
| `POST` | `/v1/auth-profiles/:id/revoke` | Locally disable and clear a profile; call an OAuth `revocationUrl` when configured |

Create an API-key profile with `authType: "api_key"`, safe config such as `{"headerName":"x-api-key"}`, and secret payload `{"apiKey":"..."}`. OAuth profiles use `config.tokenUrl` and optional `scope`/`audience`/`revocationUrl`; put `clientId` and `clientSecret` in `secret`. Access/refresh tokens are cached encrypted in the vault and refreshed before expiry. Profile scope is `service`, `agent`, or `user`. Assign user identities to agents before using user-scoped profiles.

## MCP connections

| Method | Route | Use |
| --- | --- | --- |
| `GET`, `POST`, `PATCH`, `DELETE` | `/v1/mcp-servers` | Manage MCP server connections |
| `POST` | `/v1/mcp-servers/:id/test` | Test and synchronize discovery |
| `POST` | `/v1/mcp-servers/:id/refresh` | Refresh tools, schemas, capabilities, and breaking-change history |

HTTP registration uses `transport` (`streamable-http` or `sse`), `url`, and an `authProfileId`. STDIO registration uses `transport: "stdio"`, an allowlisted Docker `image`, and an argument array. The API discovers tools on registration and refresh, stores original input/output schemas, and flags breaking changes.

## Agents, groups, approvals, and execution

| Method | Route | Use |
| --- | --- | --- |
| `GET`, `POST`, `PATCH`, `DELETE` | `/v1/agents` | Manage agent API keys |
| `PUT`, `DELETE` | `/v1/agents/:agentId/tools/:toolId` | Assign/revoke a tool for an agent |
| `PUT`, `DELETE` | `/v1/agents/:agentId/users/:userId` | Grant/revoke user-scoped credential use |
| `POST`, `DELETE` | `/v1/groups` | Create/delete teams and projects |
| `PUT`, `DELETE` | `/v1/groups/:groupId/agents/:agentId` | Add/remove agent membership |
| `PUT`, `DELETE` | `/v1/groups/:groupId/tools/:toolId` | Assign/revoke a tool for a team/project |
| `GET` | `/v1/registry/tools?search=&tags=&capability=&provider=&owner=` | Agent discovery, filtered to enabled and authorized tools |
| `GET` | `/v1/agents/:agentId/direct-tools` | List tools granted directly to an agent (excludes group grants) |
| `GET` | `/v1/groups/:id/agents`, `/v1/groups/:id/tools` | Inspect team/project membership and assigned tools |
| `POST` | `/v1/registry/tools/:id/approvals` | Request approval for sensitive tool arguments |
| `GET`, `POST` | `/v1/approvals` and `/v1/approvals/:id/review` | Admin review; approvals expire and are single-use, argument- and version-bound |
| `POST` | `/v1/registry/tools/:id/execute` | Execute an authorized tool through the gateway |
| `GET` | `/v1/executions`, `/v1/audit` | Inspect sanitized execution and audit history |

Sensitive operations are flagged from MCP destructive hints and sensitive tool names/capabilities, or explicitly with `requiresApproval: true`. To execute after approval, send the same JSON body as the request with `X-Approval-Id` set to the approved ID. Each tool has configurable retries and a persistent per-agent rate limit.

## Built-in tags

`OS`, `MCP`, `API`, `Database`, `Developer Tools`, `Cloud`, `Browser`, `Files`, `Communication`, `Monitoring`, `AI/ML`, and `Custom`. Multiple tags can be assigned to each tool; custom tag names can also be added.
