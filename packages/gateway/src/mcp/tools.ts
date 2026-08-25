import {
  MemoryDomainError,
  parseClassification,
  parseMemoryKind,
  POLICY_VERSION,
  UNTRUSTED_MEMORY_NOTICE,
} from '@enterprise-memory/core';

import type { MemoryContext, MemoryService, Principal } from '@enterprise-memory/core';

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
  { uri: 'memory://profiles/employee-agent', name: 'Employee agent profile schema', mimeType: 'application/json' },
] as const;

type ToolName =
  | 'memory_search'
  | 'memory_remember'
  | 'memory_forget'
  | 'memory_history'
  | 'memory_profile_get';

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
          context: asContext(record['context']),
          text: asOptionalString(record['text']),
          kind: optionalKind(record['kind']),
          limit: asOptionalNumber(record['limit']),
        },
        { protocol: 'mcp' },
      );
    case 'memory_remember':
      return memory.remember(
        {
          principal,
          context: asContext(record['context']),
          kind: parseMemoryKind(asRequiredString(record['kind'], 'kind')),
          classification: parseClassification(asRequiredString(record['classification'], 'classification')),
          fact: asRequiredString(record['fact'], 'fact'),
        },
        { protocol: 'mcp' },
      );
    case 'memory_forget':
      await memory.forget(asRequiredString(record['id'], 'id'), principal, { protocol: 'mcp' });
      return { deleted: true };
    case 'memory_history':
      return memory.history(asRequiredString(record['id'], 'id'), principal, { protocol: 'mcp' });
    case 'memory_profile_get':
      return memory.getProfile('employee-agent', principal, { protocol: 'mcp' });
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
    case 'memory://profiles/employee-agent':
      return {
        schema: 'employee-agent',
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

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asContext(value: unknown): MemoryContext {
  if (value === undefined || value === 'personal') {
    return 'personal';
  }
  if (value === 'current_project') {
    return 'current_project';
  }
  throw new MemoryDomainError('invalid_input', 'context must be personal or current_project');
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryDomainError('invalid_input', `Missing ${field}`);
  }
  return value;
}

function optionalKind(value: unknown) {
  return typeof value === 'string' ? parseMemoryKind(value) : undefined;
}
