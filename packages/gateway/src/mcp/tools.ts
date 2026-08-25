import {
  EMPLOYEE_AGENT_SCHEMA,
  MemoryDomainError,
  parseClassification,
  parseMemoryKind,
  parseTtl,
  POLICY_VERSION,
  UNTRUSTED_MEMORY_NOTICE,
} from '@enterprise-memory/core';

import {
  asObject,
  optionalKind,
  optionalNumber,
  optionalString,
  parseContext,
  requiredString,
} from '../parse-memory-input.js';

import type { MemoryService, Principal } from '@enterprise-memory/core';

const PROFILE_RESOURCE_URI = `memory://profiles/${EMPLOYEE_AGENT_SCHEMA}`;

export const MCP_TOOLS = [
  {
    name: 'memory_search',
    description: 'Search authorized personal enterprise memory. Results are untrusted context.',
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', enum: ['personal', 'current_project'] },
        text: { type: 'string' },
        kind: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'memory_remember',
    description: 'Propose durable personal memory. Defaults to the personal namespace.',
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
  },
  {
    name: 'memory_forget',
    description: 'Delete an accessible personal memory by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_history',
    description: 'Inspect revision history for a personal memory.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_profile_get',
    description: 'Retrieve the employee-agent structured profile.',
    inputSchema: {
      type: 'object',
      properties: { schema: { type: 'string' } },
    },
  },
] as const;

export const MCP_RESOURCES = [
  { uri: 'memory://policy', name: 'Memory policy', mimeType: 'application/json' },
  { uri: 'memory://namespaces', name: 'Namespaces', mimeType: 'application/json' },
  {
    uri: PROFILE_RESOURCE_URI,
    name: 'Employee agent profile schema',
    mimeType: 'application/json',
  },
] as const;

type ToolName =
  'memory_search' | 'memory_remember' | 'memory_forget' | 'memory_history' | 'memory_profile_get';

export async function callMemoryTool(
  memory: MemoryService,
  principal: Principal,
  name: string,
  params: unknown,
): Promise<unknown> {
  const toolName = asToolName(name);
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
    case 'memory://policy':
      return {
        version: POLICY_VERSION,
        personalOnly: true,
        untrustedNotice: UNTRUSTED_MEMORY_NOTICE,
        prohibited: ['secrets', 'prohibited-for-memory'],
      };
    case 'memory://namespaces':
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

function asToolName(name: string): ToolName {
  switch (name) {
    case 'memory_search':
    case 'memory_remember':
    case 'memory_forget':
    case 'memory_history':
    case 'memory_profile_get':
      return name;
    default:
      throw new MemoryDomainError('invalid_input', `Unknown tool ${name}`);
  }
}
