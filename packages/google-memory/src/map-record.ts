import { EMPLOYEE_AGENT_SCHEMA, toMemoryBankScope } from '@enterprise-memory/core';

import type {
  MemoryRecord,
  MemoryRevision,
  MemorySearchQuery,
  Principal,
  ProfileOutcome,
  RememberInput,
} from '@enterprise-memory/core';

type JsonObject = { readonly [key: string]: unknown };

export function generateMemoriesBody(input: RememberInput): JsonObject {
  const scope = toMemoryBankScope(input.context, input.principal);
  return {
    scope,
    directMemoriesSource: {
      directMemories: [{ fact: `${input.kind}: ${input.fact}` }],
    },
  };
}

export function retrieveMemoriesBody(query: MemorySearchQuery): JsonObject {
  const scope = toMemoryBankScope(query.context, query.principal);
  if (query.text !== undefined && query.text.trim() !== '') {
    return {
      scope,
      similaritySearchParams: {
        searchQuery: query.text,
        topK: query.limit ?? 8,
      },
    };
  }
  return {
    scope,
    simpleRetrievalParams: { pageSize: query.limit ?? 8 },
  };
}

export function retrieveProfilesBody(principal: Principal): JsonObject {
  return { scope: toMemoryBankScope('personal', principal) };
}

export function parseGeneratedMemoryName(body: unknown): string | undefined {
  if (!isObject(body)) {
    return undefined;
  }
  const generated = body['generatedMemories'];
  if (!Array.isArray(generated) || generated[0] === undefined || !isObject(generated[0])) {
    return memoryNameFrom(body);
  }
  const memory = generated[0]['memory'];
  if (isObject(memory) && typeof memory['name'] === 'string') {
    return memory['name'];
  }
  return memoryNameFrom(body);
}

export function parseRetrievedMemories(body: unknown, principal: Principal): MemoryRecord[] {
  if (!isObject(body) || !Array.isArray(body['retrievedMemories'])) {
    return [];
  }
  const records: MemoryRecord[] = [];
  for (const item of body['retrievedMemories']) {
    if (!isObject(item)) {
      continue;
    }
    const memory = isObject(item['memory']) ? item['memory'] : item;
    const parsed = parseMemoryResource(memory, principal);
    if (parsed !== undefined) {
      records.push(parsed);
    }
  }
  return records;
}

export function parseMemoryResource(memory: JsonObject, principal: Principal): MemoryRecord | undefined {
  const name = memory['name'];
  const fact = memory['fact'];
  if (typeof name !== 'string' || typeof fact !== 'string') {
    return undefined;
  }
  const id = name.split('/').at(-1) ?? name;
  const { kind, text } = splitKindFact(fact);
  const expireAt = typeof memory['expireTime'] === 'string' ? memory['expireTime'] : undefined;
  const createdAt = typeof memory['createTime'] === 'string' ? memory['createTime'] : new Date(0).toISOString();
  const updatedAt = typeof memory['updateTime'] === 'string' ? memory['updateTime'] : createdAt;
  return {
    id,
    kind,
    namespace: 'personal',
    principalId: principal.id,
    classification: 'internal',
    fact: text,
    createdAt,
    updatedAt,
    expireAt,
  };
}

export function parseRevisions(body: unknown, memoryId: string): MemoryRevision[] {
  if (!isObject(body) || !Array.isArray(body['memoryRevisions'])) {
    return [];
  }
  const revisions: MemoryRevision[] = [];
  for (const item of body['memoryRevisions']) {
    if (!isObject(item)) {
      continue;
    }
    const name = typeof item['name'] === 'string' ? item['name'] : '';
    const revisionId = name.split('/').at(-1) ?? name;
    const updatedAt = typeof item['createTime'] === 'string' ? item['createTime'] : new Date(0).toISOString();
    revisions.push({
      revisionId,
      memoryId,
      updatedAt,
      action: 'updated',
    });
  }
  return revisions;
}

export function parseProfile(body: unknown, principal: Principal): ProfileOutcome {
  const fields: Record<string, unknown> = {};
  if (isObject(body) && isObject(body['profiles'])) {
    const profile = body['profiles'][EMPLOYEE_AGENT_SCHEMA];
    if (isObject(profile) && isObject(profile['profile'])) {
      Object.assign(fields, profile['profile']);
    }
  }
  return {
    status: 'ok',
    profile: { schema: EMPLOYEE_AGENT_SCHEMA, principalId: principal.id, fields },
    notice: '',
  };
}

function splitKindFact(fact: string): { kind: MemoryRecord['kind']; text: string } {
  const separator = fact.indexOf(': ');
  if (separator <= 0) {
    return { kind: 'fact', text: fact };
  }
  const maybeKind = fact.slice(0, separator);
  const kinds: readonly MemoryRecord['kind'][] = [
    'identity',
    'preference',
    'fact',
    'procedure',
    'episode',
    'relationship',
    'constraint',
    'working',
  ];
  const kind = kinds.find((item) => item === maybeKind);
  if (kind === undefined) {
    return { kind: 'fact', text: fact };
  }
  return { kind, text: fact.slice(separator + 2) };
}

function memoryNameFrom(body: JsonObject): string | undefined {
  const response = body['response'];
  if (isObject(response)) {
    return parseGeneratedMemoryName(response);
  }
  return undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
