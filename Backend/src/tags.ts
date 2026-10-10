import { query } from './db.js';

export async function setToolTags(toolId: string, names: string[]) {
  const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  await query('DELETE FROM tool_tags WHERE tool_id = $1', [toolId]);
  for (const name of normalized) {
    await query('INSERT INTO tags (name, is_predefined) VALUES ($1, false) ON CONFLICT (name) DO NOTHING', [name]);
    await query('INSERT INTO tool_tags (tool_id, tag_id) SELECT $1, id FROM tags WHERE name = $2 ON CONFLICT DO NOTHING', [toolId, name]);
  }
}

export async function getTool(id: string) {
  const result = await query(`SELECT t.*,ap.auth_type AS profile_auth_type,ap.scope_type AS profile_scope_type,ap.config AS profile_config,COALESCE(jsonb_agg(jsonb_build_object('name',g.name,'description',g.description)) FILTER (WHERE g.id IS NOT NULL), '[]'::jsonb) AS tags,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('principalType',p.principal_type,'principalId',p.principal_id)) FROM (SELECT 'agent'::text AS principal_type,a.id AS principal_id FROM tool_permissions tp JOIN agents a ON a.id=tp.agent_id WHERE tp.tool_id=t.id UNION ALL SELECT cg.group_type::text AS principal_type,cg.id AS principal_id FROM group_tool_permissions gp JOIN catalog_groups cg ON cg.id=gp.group_id WHERE gp.tool_id=t.id) p),'[]'::jsonb) AS access_policies
    FROM tools t LEFT JOIN auth_profiles ap ON ap.id=t.auth_profile_id LEFT JOIN tool_tags tt ON tt.tool_id=t.id LEFT JOIN tags g ON g.id=tt.tag_id WHERE t.id=$1 GROUP BY t.id,ap.id`, [id]);
  return result.rows[0];
}

export const safeTool = (row: Record<string, any>) => {
  return {
    ...row,
    authentication: { profileId:row.auth_profile_id??null,type:row.profile_auth_type??'none',scopeType:row.profile_scope_type??'service',headerNames:row.profile_config?.headerNames??[] },
    profile_auth_type:undefined,profile_scope_type:undefined,profile_config:undefined,
  };
};
