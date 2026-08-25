import {
  assertMemoryId,
  isMemoryDomainError,
  MemoryDomainError,
  STORE_UNAVAILABLE_REASON,
  UNTRUSTED_MEMORY_NOTICE,
} from '@enterprise-memory/core';

import { memoryBankBaseUrl, memoryBankParent } from './config.js';
import {
  generateMemoriesBody,
  isObject,
  ownerFromMemory,
  parseGeneratedMemoryName,
  parseMemoryResource,
  parseProfile,
  parseRetrievedMemories,
  parseRevisions,
  retrieveMemoriesBody,
  retrieveProfilesBody,
} from './map-record.js';

import type { AccessTokenProvider, GoogleMemoryConfig, HttpClient } from './config.js';
import type {
  HistoryOutcome,
  MemoryId,
  MemoryRecord,
  MemorySearchQuery,
  MemoryStore,
  Principal,
  ProfileOutcome,
  ProfileSchemaId,
  RememberInput,
  SearchOutcome,
} from '@enterprise-memory/core';

export function createGoogleMemoryStore(input: {
  config: GoogleMemoryConfig;
  http: HttpClient;
  tokens: AccessTokenProvider;
}): MemoryStore {
  const parent = memoryBankParent(input.config);
  const base = memoryBankBaseUrl(input.config.location);

  return {
    async search(query: MemorySearchQuery): Promise<SearchOutcome> {
      try {
        const body = await requestJson(
          input,
          'POST',
          `${base}/v1beta1/${parent}/memories:retrieve`,
          retrieveMemoriesBody(query),
        );
        const memories = parseRetrievedMemories(body, query.principal);
        if (memories === undefined) {
          return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
        }
        return {
          status: 'ok',
          memories,
          notice: UNTRUSTED_MEMORY_NOTICE,
        };
      } catch (error) {
        if (isMemoryDomainError(error) && error.code !== 'unavailable') {
          throw error;
        }
        return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
      }
    },

    async remember(rememberInput: RememberInput): Promise<MemoryRecord> {
      const operation = await requestJson(
        input,
        'POST',
        `${base}/v1beta1/${parent}/memories:generate`,
        generateMemoriesBody(rememberInput),
      );
      const done = await awaitOperation(input, base, operation);
      const name = parseGeneratedMemoryName(done);
      if (name === undefined) {
        throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
      }
      const resource = await requestJson(input, 'GET', `${base}/v1beta1/${name}`);
      const parsed = isObject(resource)
        ? parseMemoryResource(resource, rememberInput.principal)
        : undefined;
      if (parsed === undefined) {
        throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
      }
      return parsed;
    },

    async forget(id: MemoryId, principal: Principal): Promise<void> {
      await requireOwnedMemory(input, base, parent, id, principal);
      await requestJson(input, 'DELETE', memoryResourceUrl(base, parent, id));
    },

    async history(id: MemoryId, principal: Principal): Promise<HistoryOutcome> {
      try {
        await requireOwnedMemory(input, base, parent, id, principal);
        const body = await requestJson(
          input,
          'GET',
          `${memoryResourceUrl(base, parent, id)}/revisions`,
        );
        return { status: 'ok', revisions: parseRevisions(body, id) };
      } catch (error) {
        if (isMemoryDomainError(error)) {
          throw error;
        }
        return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
      }
    },

    async getProfile(_schema: ProfileSchemaId, principal: Principal): Promise<ProfileOutcome> {
      try {
        const body = await requestJson(
          input,
          'POST',
          `${base}/v1beta1/${parent}/memories:retrieveProfiles`,
          retrieveProfilesBody(principal),
        );
        const parsed = parseProfile(body, principal);
        if (parsed.status === 'ok') {
          return { ...parsed, notice: UNTRUSTED_MEMORY_NOTICE };
        }
        return parsed;
      } catch (error) {
        if (isMemoryDomainError(error) && error.code !== 'unavailable') {
          throw error;
        }
        return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
      }
    },
  };
}

async function requireOwnedMemory(
  input: { http: HttpClient; tokens: AccessTokenProvider },
  base: string,
  parent: string,
  id: MemoryId,
  principal: Principal,
): Promise<void> {
  const resource = await requestJson(input, 'GET', memoryResourceUrl(base, parent, id));
  if (!isObject(resource) || ownerFromMemory(resource) !== principal.id) {
    throw new MemoryDomainError('not_found', 'Memory not found');
  }
}

function memoryResourceUrl(base: string, parent: string, id: MemoryId): string {
  return `${base}/v1beta1/${parent}/memories/${encodeURIComponent(assertMemoryId(id))}`;
}

async function awaitOperation(
  input: { http: HttpClient; tokens: AccessTokenProvider },
  base: string,
  operation: unknown,
): Promise<unknown> {
  if (isObject(operation) && operation['done'] === true) {
    return operation['response'] ?? operation;
  }
  if (isObject(operation) && typeof operation['name'] === 'string') {
    const body = await requestJson(input, 'GET', `${base}/v1beta1/${operation['name']}`);
    if (isObject(body) && body['done'] === true) {
      return body['response'] ?? body;
    }
  }
  throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
}

async function requestJson(
  input: { http: HttpClient; tokens: AccessTokenProvider },
  method: string,
  url: string,
  body?: unknown,
): Promise<unknown> {
  const token = await input.tokens.getAccessToken();
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  const response = await input.http.fetch(url, init);
  if (response.status === 404) {
    throw new MemoryDomainError('not_found', 'Memory not found');
  }
  if (!response.ok) {
    throw new Error(`google-memory-http-${String(response.status)}`);
  }
  if (response.status === 204) {
    return {};
  }
  return response.json();
}
