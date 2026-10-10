CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  transport text NOT NULL CHECK (transport IN ('streamable-http', 'sse')),
  connection_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error', 'disabled')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_type text NOT NULL CHECK (registration_type IN ('mcp', 'http')),
  mcp_server_id uuid REFERENCES mcp_servers(id) ON DELETE CASCADE,
  external_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  endpoint text,
  http_method text CHECK (http_method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')),
  headers_encrypted text,
  auth_encrypted text,
  query_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  path_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 100 AND 120000),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mcp_server_id, external_id),
  CHECK ((registration_type = 'mcp' AND mcp_server_id IS NOT NULL AND external_id IS NOT NULL)
      OR (registration_type = 'http' AND mcp_server_id IS NULL AND endpoint IS NOT NULL AND http_method IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tools_name_idx ON tools USING gin (to_tsvector('simple', name || ' ' || description));
CREATE INDEX IF NOT EXISTS tools_type_enabled_idx ON tools (registration_type, enabled);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_predefined boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tool_tags (
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (tool_id, tag_id)
);

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  api_key_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tool_permissions (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool_id)
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid REFERENCES tools(id) ON DELETE SET NULL,
  agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('test', 'execute', 'mcp_sync')),
  status text NOT NULL CHECK (status IN ('success', 'error')),
  duration_ms integer NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS execution_logs_created_idx ON execution_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_records_created_idx ON audit_records (created_at DESC);

INSERT INTO tags (name, description, is_predefined) VALUES
 ('OS', 'File system, terminal, processes', true),
 ('MCP', 'MCP servers and their tools', true),
 ('API', 'REST APIs and HTTP endpoints', true),
 ('Database', 'SQL and database operations', true),
 ('Developer Tools', 'Git, testing, debugging', true),
 ('Cloud', 'Azure, AWS, GCP', true),
 ('Browser', 'Web search and browsing', true),
 ('Files', 'File reading, writing, searching', true),
 ('Communication', 'Email, Slack, messaging', true),
 ('Monitoring', 'Logs, metrics, alerts', true),
 ('AI/ML', 'Models, embeddings, vector search', true),
 ('Custom', 'User-defined tags', true)
ON CONFLICT (name) DO NOTHING;
