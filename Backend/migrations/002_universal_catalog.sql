ALTER TABLE mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_transport_check;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_transport_check CHECK (transport IN ('stdio','streamable-http','sse'));
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS connection_spec jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS auth_profile_id uuid;
ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tools ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}';
ALTER TABLE tools ADD COLUMN IF NOT EXISTS output_schema jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'admin';
ALTER TABLE tools ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT '';
ALTER TABLE tools ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown','healthy','degraded','unhealthy'));
ALTER TABLE tools ADD COLUMN IF NOT EXISTS retry_config jsonb NOT NULL DEFAULT '{"maxRetries":0,"backoffMs":250}'::jsonb;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS rate_limit jsonb NOT NULL DEFAULT '{"maxRequests":60,"windowSeconds":60}'::jsonb;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS deprecated boolean NOT NULL DEFAULT false;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS auth_profile_id uuid;

CREATE TABLE IF NOT EXISTS secret_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  auth_type text NOT NULL CHECK (auth_type IN ('none','api_key','basic','bearer','oauth2','client_credentials','custom_headers','mcp')),
  scope_type text NOT NULL DEFAULT 'service' CHECK (scope_type IN ('service','agent','user')),
  scope_id text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref uuid REFERENCES secret_vault(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  last_validated_at timestamptz,
  last_validation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_user_scopes (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_id,user_id)
);
CREATE TABLE IF NOT EXISTS catalog_groups (
  id text PRIMARY KEY,
  name text NOT NULL,
  group_type text NOT NULL CHECK(group_type IN ('team','project')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_group_members (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES catalog_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(agent_id,group_id)
);
CREATE TABLE IF NOT EXISTS group_tool_permissions (
  group_id text NOT NULL REFERENCES catalog_groups(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,tool_id)
);
ALTER TABLE tools ADD CONSTRAINT tools_auth_profile_fk FOREIGN KEY (auth_profile_id) REFERENCES auth_profiles(id) ON DELETE SET NULL;
ALTER TABLE mcp_servers ADD CONSTRAINT mcp_servers_auth_profile_fk FOREIGN KEY (auth_profile_id) REFERENCES auth_profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tool_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  schema_breaking boolean NOT NULL DEFAULT false,
  change_summary text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tool_id, version)
);
CREATE TABLE IF NOT EXISTS tool_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id text,
  tool_version integer NOT NULL,
  arguments_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','consumed')),
  reviewed_by text,
  reviewed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tool_rate_limits (
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  bucket_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY(tool_id,principal_id,bucket_start)
);
ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1;
ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES tool_approvals(id) ON DELETE SET NULL;
ALTER TABLE execution_logs ADD COLUMN IF NOT EXISTS latency_ms integer;

CREATE INDEX IF NOT EXISTS tools_capabilities_idx ON tools USING gin (capabilities);
CREATE INDEX IF NOT EXISTS tools_owner_provider_idx ON tools (owner,provider);
CREATE INDEX IF NOT EXISTS auth_profiles_scope_idx ON auth_profiles (scope_type,scope_id);
CREATE INDEX IF NOT EXISTS tool_versions_lookup_idx ON tool_versions (tool_id,version DESC);
CREATE INDEX IF NOT EXISTS tool_approvals_pending_idx ON tool_approvals (status,created_at DESC);
