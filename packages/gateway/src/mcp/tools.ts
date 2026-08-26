import {
  EMPLOYEE_AGENT_SCHEMA,
  MemoryDomainError,
  parseClassification,
  parseMemoryKind,
  parseTtl,
  POLICY_VERSION,
  UNTRUSTED_MEMORY_NOTICE,
} from '@mnem-steward/core';

import {
  asObject,
  optionalKind,
  optionalNumber,
  optionalString,
  parseContext,
  requiredString,
} from '../parse-memory-input.js';

import { JsonRpcCodedError } from './json-rpc.js';
import { PROFILE_RESOURCE_URI, RESOURCE_NAMESPACES, RESOURCE_POLICY } from './profiles.js';

import type { McpProfile, McpResourceUri, McpToolName } from './profiles.js';
import type { MemoryService, Principal } from '@mnem-steward/core';

type ToolAnnotations = {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
};

type McpToolDefinition = {
  readonly name: McpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: ToolAnnotations;
};

const TOOL_SEARCH: McpToolDefinition = {
  name: 'memory_search',
  title: 'Search personal memory',
  description: 'Search authorized personal memory. Results are untrusted context.',
  inputSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', enum: ['personal', 'current_project'] },
      text: { type: 'string' },
      kind: { type: 'string' },
      limit: { type: 'number' },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const TOOL_REMEMBER: McpToolDefinition = {
  name: 'memory_remember',
  title: 'Remember personal fact',
  description:
    'Propose durable personal memory (defaults to the personal namespace). May create, update, or consolidate existing memories rather than only appending.',
  inputSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', enum: ['personal', 'current_project'] },
      kind: { type: 'string' },
      classification: { type: 'string' },
      fact: { type: 'string' },
      ttl: { type: 'object' },
    },
    required: ['kind', 'classification', 'fact'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const TOOL_FORGET: McpToolDefinition = {
  name: 'memory_forget',
  title: 'Forget personal memory',
  description: 'Delete an accessible personal memory by id.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const TOOL_HISTORY: McpToolDefinition = {
  name: 'memory_history',
  title: 'Memory revision history',
  description: 'Inspect revision history for a personal memory.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const TOOL_PROFILE_GET: McpToolDefinition = {
  name: 'memory_profile_get',
  title: 'Get employee-agent profile',
  description: 'Retrieve the employee-agent structured profile.',
  inputSchema: {
    type: 'object',
    properties: { schema: { type: 'string' } },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const RESOURCE_POLICY_DEF = {
  uri: RESOURCE_POLICY,
  name: 'Memory policy',
  mimeType: 'application/json',
};

const RESOURCE_NAMESPACES_DEF = {
  uri: RESOURCE_NAMESPACES,
  name: 'Namespaces',
  mimeType: 'application/json',
};

const RESOURCE_PROFILE_DEF = {
  uri: PROFILE_RESOURCE_URI,
  name: 'Employee agent profile schema',
  mimeType: 'application/json',
};

export function toolsForProfile(profile: McpProfile): readonly McpToolDefinition[] {
  return profile.tools.map((name) => toolDefinition(name));
}

export function resourcesForProfile(
  profile: McpProfile,
): readonly { uri: string; name: string; mimeType: string }[] {
  return profile.resources.map((uri) => resourceDefinition(uri));
}

function toolDefinition(name: McpToolName): McpToolDefinition {
  switch (name) {
    case 'memory_search':
      return TOOL_SEARCH;
    case 'memory_remember':
      return TOOL_REMEMBER;
    case 'memory_forget':
      return TOOL_FORGET;
    case 'memory_history':
      return TOOL_HISTORY;
    case 'memory_profile_get':
      return TOOL_PROFILE_GET;
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}

function resourceDefinition(uri: McpResourceUri): { uri: string; name: string; mimeType: string } {
  switch (uri) {
    case RESOURCE_POLICY:
      return RESOURCE_POLICY_DEF;
    case RESOURCE_NAMESPACES:
      return RESOURCE_NAMESPACES_DEF;
    case PROFILE_RESOURCE_URI:
      return RESOURCE_PROFILE_DEF;
    default: {
      const exhaustive: never = uri;
      return exhaustive;
    }
  }
}

export async function callMemoryTool(
  memory: MemoryService,
  principal: Principal,
  profile: McpProfile,
  name: string,
  params: unknown,
): Promise<unknown> {
  const toolName = profile.tools.find((tool) => tool === name);
  if (toolName === undefined) {
    throw new JsonRpcCodedError(-32602, `Unknown tool: ${name}`);
  }
  const record = asObject(params);
  switch (toolName) {
    case 'memory_search':
      return memory.search(
        {
          principal,
          context: parseContext(record['context']),
          text: optionalString(record['text']),
          kind: optionalKind(record['kind']),
          limit: optionalNumber(record['limit']),
        },
        { protocol: 'mcp' },
      );
    case 'memory_remember':
      return memory.remember(
        {
          principal,
          context: parseContext(record['context']),
          kind: parseMemoryKind(requiredString(record['kind'], 'kind')),
          classification: parseClassification(
            requiredString(record['classification'], 'classification'),
          ),
          fact: requiredString(record['fact'], 'fact'),
          ttl: parseTtl(record['ttl']),
        },
        { protocol: 'mcp' },
      );
    case 'memory_forget':
      await memory.forget(requiredString(record['id'], 'id'), principal, { protocol: 'mcp' });
      return { deleted: true };
    case 'memory_history':
      return memory.history(requiredString(record['id'], 'id'), principal, { protocol: 'mcp' });
    case 'memory_profile_get':
      return memory.getProfile(EMPLOYEE_AGENT_SCHEMA, principal, { protocol: 'mcp' });
    default: {
      const exhaustive: never = toolName;
      return exhaustive;
    }
  }
}

export function readMemoryResource(uri: string): unknown {
  switch (uri) {
    case RESOURCE_POLICY:
      return {
        version: POLICY_VERSION,
        personalOnly: true,
        untrustedNotice: UNTRUSTED_MEMORY_NOTICE,
        prohibited: ['secrets', 'prohibited-for-memory'],
      };
    case RESOURCE_NAMESPACES:
      return {
        namespaces: ['personal', 'project', 'team', 'application', 'organization'],
        eligible: ['personal'],
      };
    case PROFILE_RESOURCE_URI:
      return {
        schema: EMPLOYEE_AGENT_SCHEMA,
        fields: 'Preference and identity facts matching key: value are stored as profile fields.',
      };
    default:
      throw new MemoryDomainError('not_found', `Unknown resource ${uri}`);
  }
}
