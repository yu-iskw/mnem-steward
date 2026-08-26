import {
  DEFAULT_SEARCH_LIMIT,
  EMPLOYEE_AGENT_SCHEMA,
  toMemoryBankScope,
  tryParseClassification,
  tryParseMemoryKind,
} from '@mnem-steward/core';

import type {
  Classification,
  MemoryRecord,
  MemoryRevision,
  MemorySearchQuery,
  Principal,
  ProfileOutcome,
  RememberInput,
} from '@mnem-steward/core';

type JsonObject = { readonly [key: string]: unknown };

export function generateMemoriesBody(input: RememberInput): JsonObject {
  const scope = toMemoryBankScope(input.context, input.principal);
  // DirectMemory accepts only `fact` (proto). Memory TTL is applied via PATCH after generate.
  // revisionExpireTime expires revision snapshots only (default 365d), not the Memory resource.
  const revisionExpireTime =
    input.ttl !== undefined && 'expireAt' in input.ttl ? input.ttl.expireAt : undefined;
  return {
    scope,
    directMemoriesSource: {
      directMemories: [
        {
          fact: encodeStoredFact(input.kind, input.classification, input.fact),
        },
      ],
    },
    ...(revisionExpireTime === undefined ? {} : { revisionExpireTime }),
  };
}

export type GeneratedMemoryAction = 'CREATED' | 'UPDATED' | 'DELETED';

export type ParsedGeneratedMemory = {
  readonly name: string;
  readonly action: GeneratedMemoryAction;
};

/**
 * Prefer CREATED, then UPDATED. DELETED-only is returned so the store can skip GET (404).
 */
export function parseGeneratedMemories(body: unknown): readonly ParsedGeneratedMemory[] {
  const root = unwrapGenerateResponse(body);
  if (root === undefined) {
    return [];
  }
  const generated = root['generatedMemories'];
  if (!Array.isArray(generated)) {
    return [];
  }
  const parsed: ParsedGeneratedMemory[] = [];
  for (const item of generated) {
    if (!isObject(item)) {
      continue;
    }
    const memory = item['memory'];
    const name =
      isObject(memory) && typeof memory['name'] === 'string' ? memory['name'] : undefined;
    if (name === undefined) {
      continue;
    }
    parsed.push({ name, action: normalizeGeneratedAction(item['action']) });
  }
  return parsed;
}

export function selectLiveGeneratedMemory(
  memories: readonly ParsedGeneratedMemory[],
): ParsedGeneratedMemory | undefined {
  const created = memories.find((item) => item.action === 'CREATED');
  if (created !== undefined) {
    return created;
  }
  return memories.find((item) => item.action === 'UPDATED');
}

export function memoryRecordFromDeletedGenerate(name: string, input: RememberInput): MemoryRecord {
  const id = name.split('/').at(-1) ?? name;
  const now = new Date().toISOString();
  const expireAt =
    input.ttl !== undefined && 'expireAt' in input.ttl ? input.ttl.expireAt : undefined;
  return {
    id,
    kind: input.kind,
    namespace: 'personal',
    principalId: input.principal.id,
    classification: input.classification,
    fact: input.fact,
    createdAt: now,
    updatedAt: now,
    expireAt,
  };
}

export function patchExpireTimeBody(expireAt: string): JsonObject {
  return { expireTime: expireAt };
}

export function retrieveMemoriesBody(query: MemorySearchQuery): JsonObject {
  const scope = toMemoryBankScope(query.context, query.principal);
  const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
  if (query.text !== undefined && query.text.trim() !== '') {
    return {
      scope,
      similaritySearchParams: {
        searchQuery: query.text,
        topK: limit,
      },
    };
  }
  return {
    scope,
    simpleRetrievalParams: { pageSize: limit },
  };
}

export function retrieveProfilesBody(principal: Principal): JsonObject {
  return { scope: toMemoryBankScope('personal', principal) };
}

/** @deprecated Prefer parseGeneratedMemories + selectLiveGeneratedMemory */
export function parseGeneratedMemoryName(body: unknown): string | undefined {
  const live = selectLiveGeneratedMemory(parseGeneratedMemories(body));
  if (live !== undefined) {
    return live.name;
  }
  const deleted = parseGeneratedMemories(body).find((item) => item.action === 'DELETED');
  return deleted?.name;
}

export function parseRetrievedMemories(
  body: unknown,
  principal: Principal,
): MemoryRecord[] | undefined {
  if (!isObject(body) || !Array.isArray(body['retrievedMemories'])) {
    return undefined;
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

export function parseMemoryResource(
  memory: JsonObject,
  principal: Principal,
): MemoryRecord | undefined {
  const name = memory['name'];
  const fact = memory['fact'];
  if (typeof name !== 'string' || typeof fact !== 'string') {
    return undefined;
  }
  const owner = ownerFromMemory(memory);
  if (owner !== undefined && owner !== principal.id) {
    return undefined;
  }
  const id = name.split('/').at(-1) ?? name;
  const { kind, classification, text } = splitKindFact(fact);
  const expireAt = typeof memory['expireTime'] === 'string' ? memory['expireTime'] : undefined;
  const createdAt =
    typeof memory['createTime'] === 'string' ? memory['createTime'] : new Date(0).toISOString();
  const updatedAt = typeof memory['updateTime'] === 'string' ? memory['updateTime'] : createdAt;
  return {
    id,
    kind,
    namespace: 'personal',
    principalId: principal.id,
    classification,
    fact: text,
    createdAt,
    updatedAt,
    expireAt,
  };
}

export function ownerFromMemory(memory: JsonObject): string | undefined {
  const scope = isObject(memory['scope']) ? memory['scope'] : undefined;
  return scope !== undefined && typeof scope['principal_id'] === 'string'
    ? scope['principal_id']
    : undefined;
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
    const updatedAt =
      typeof item['createTime'] === 'string' ? item['createTime'] : new Date(0).toISOString();
    // Deletion snapshots have an empty fact (Memory Bank revisions docs).
    const fact = typeof item['fact'] === 'string' ? item['fact'] : undefined;
    const action: MemoryRevision['action'] =
      fact !== undefined && fact.trim() === '' ? 'deleted' : 'updated';
    revisions.push({
      revisionId,
      memoryId,
      updatedAt,
      action,
    });
  }
  return revisions;
}

export function parseProfile(body: unknown, principal: Principal): ProfileOutcome {
  const fields: Record<string, unknown> = {};
  if (isObject(body) && isObject(body['profiles'])) {
    const selected = Object.entries(body['profiles']).find(
      ([schema]) => schema === EMPLOYEE_AGENT_SCHEMA,
    )?.[1];
    if (isObject(selected) && isObject(selected['profile'])) {
      Object.assign(fields, selected['profile']);
    }
  }
  return {
    status: 'ok',
    profile: { schema: EMPLOYEE_AGENT_SCHEMA, principalId: principal.id, fields },
    notice: '',
  };
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeStoredFact(
  kind: MemoryRecord['kind'],
  classification: Classification,
  fact: string,
): string {
  return `${kind}|${classification}: ${fact}`;
}

function splitKindFact(fact: string): {
  kind: MemoryRecord['kind'];
  classification: Classification;
  text: string;
} {
  const separator = fact.indexOf(': ');
  if (separator <= 0) {
    return { kind: 'fact', classification: 'internal', text: fact };
  }
  const prefix = fact.slice(0, separator);
  const pipe = prefix.indexOf('|');
  if (pipe > 0) {
    const kind = tryParseMemoryKind(prefix.slice(0, pipe));
    const classification = persistableClassification(prefix.slice(pipe + 1));
    if (kind !== undefined && classification !== undefined) {
      return { kind, classification, text: fact.slice(separator + 2) };
    }
  }
  const kind = tryParseMemoryKind(prefix);
  if (kind === undefined) {
    return { kind: 'fact', classification: 'internal', text: fact };
  }
  return { kind, classification: 'internal', text: fact.slice(separator + 2) };
}

function persistableClassification(value: string): Classification | undefined {
  const parsed = tryParseClassification(value);
  if (parsed === undefined || parsed === 'prohibited-for-memory') {
    return undefined;
  }
  return parsed;
}

function unwrapGenerateResponse(body: unknown): JsonObject | undefined {
  if (!isObject(body)) {
    return undefined;
  }
  if (Array.isArray(body['generatedMemories'])) {
    return body;
  }
  const response = body['response'];
  if (isObject(response) && Array.isArray(response['generatedMemories'])) {
    return response;
  }
  return isObject(body) ? body : undefined;
}

function normalizeGeneratedAction(value: unknown): GeneratedMemoryAction {
  switch (value) {
    case 'CREATED':
    case 'UPDATED':
    case 'DELETED':
      return value;
    default:
      // Older fixtures omit action; treat as CREATED so GET still runs.
      return 'CREATED';
  }
}
