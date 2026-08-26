import { protectedResourceMetadataPath, protectedResourceMetadataUrl } from '@mnem-steward/auth';
import { EMPLOYEE_AGENT_SCHEMA } from '@mnem-steward/core';

import type { OAuthScope } from '@mnem-steward/core';

export type McpProfileId = 'memory-reader' | 'memory-steward' | 'memory-governance';

export type McpToolName =
  'memory_search' | 'memory_remember' | 'memory_forget' | 'memory_history' | 'memory_profile_get';

export const RESOURCE_POLICY = 'memory://policy' as const;
export const RESOURCE_NAMESPACES = 'memory://namespaces' as const;
export const PROFILE_RESOURCE_URI = `memory://profiles/${EMPLOYEE_AGENT_SCHEMA}` as const;

export type McpResourceUri =
  typeof RESOURCE_POLICY | typeof RESOURCE_NAMESPACES | typeof PROFILE_RESOURCE_URI;

export type McpProfile = {
  readonly id: McpProfileId;
  readonly path: `/${McpProfileId}/v1/mcp`;
  readonly serverName: string;
  readonly tools: readonly McpToolName[];
  readonly resources: readonly McpResourceUri[];
  readonly scopesSupported: readonly OAuthScope[];
};

export type McpProfileMount = {
  readonly profile: McpProfile;
  readonly resource: string;
  readonly metadataUrl: string;
  readonly metadataPath: string;
};

const ID_READER = 'memory-reader' as const;
const ID_STEWARD = 'memory-steward' as const;
const ID_GOVERNANCE = 'memory-governance' as const;

const ALL_PROFILE_IDS: readonly McpProfileId[] = [ID_READER, ID_STEWARD, ID_GOVERNANCE];

const PROFILE_READER = defineProfile({
  id: ID_READER,
  serverName: 'mnem-reader',
  tools: ['memory_search', 'memory_profile_get'],
  resources: [RESOURCE_POLICY, RESOURCE_NAMESPACES, PROFILE_RESOURCE_URI],
});

const PROFILE_STEWARD = defineProfile({
  id: ID_STEWARD,
  serverName: 'mnem-steward',
  tools: ['memory_search', 'memory_profile_get', 'memory_remember'],
  resources: [RESOURCE_POLICY, RESOURCE_NAMESPACES, PROFILE_RESOURCE_URI],
});

const PROFILE_GOVERNANCE = defineProfile({
  id: ID_GOVERNANCE,
  serverName: 'mnem-gov',
  tools: ['memory_forget', 'memory_history'],
  resources: [RESOURCE_POLICY, RESOURCE_NAMESPACES],
});

function defineProfile(input: {
  readonly id: McpProfileId;
  readonly serverName: string;
  readonly tools: readonly McpToolName[];
  readonly resources: readonly McpResourceUri[];
}): McpProfile {
  const scopes: OAuthScope[] = [];
  for (const tool of input.tools) {
    const scope = scopeForTool(tool);
    if (!scopes.includes(scope)) {
      scopes.push(scope);
    }
  }
  return {
    id: input.id,
    path: `/${input.id}/v1/mcp`,
    serverName: input.serverName,
    tools: input.tools,
    resources: input.resources,
    scopesSupported: scopes,
  };
}

function scopeForTool(tool: McpToolName): OAuthScope {
  switch (tool) {
    case 'memory_search':
      return 'memory.read';
    case 'memory_remember':
      return 'memory.write';
    case 'memory_forget':
      return 'memory.delete';
    case 'memory_history':
      return 'memory.history.read';
    case 'memory_profile_get':
      return 'memory.profile.read';
    default: {
      const exhaustive: never = tool;
      return exhaustive;
    }
  }
}

export function getMcpProfile(id: McpProfileId): McpProfile {
  switch (id) {
    case ID_READER:
      return PROFILE_READER;
    case ID_STEWARD:
      return PROFILE_STEWARD;
    case ID_GOVERNANCE:
      return PROFILE_GOVERNANCE;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function parseMcpProfiles(value: string | undefined): readonly McpProfileId[] {
  if (value === undefined || value.trim() === '') {
    return ALL_PROFILE_IDS;
  }
  const parts = value.split(',').map((part) => part.trim());
  if (parts.some((part) => part === '')) {
    throw new Error('MNEM_STEWARD_MCP_PROFILES must not contain empty segments');
  }
  const ids: McpProfileId[] = [];
  for (const part of parts) {
    const id = asMcpProfileId(part);
    if (ids.includes(id)) {
      throw new Error(`Duplicate MCP profile id: ${id}`);
    }
    ids.push(id);
  }
  return ids;
}

function asMcpProfileId(value: string): McpProfileId {
  switch (value) {
    case ID_READER:
    case ID_STEWARD:
    case ID_GOVERNANCE:
      return value;
    default:
      throw new Error(`Unknown MCP profile id: ${value}`);
  }
}

export function mcpProfileMount(publicBaseUrl: string, id: McpProfileId): McpProfileMount {
  const profile = getMcpProfile(id);
  const resource = `${publicBaseUrl}${profile.path}`;
  return {
    profile,
    resource,
    metadataUrl: protectedResourceMetadataUrl(resource),
    metadataPath: protectedResourceMetadataPath(resource),
  };
}
