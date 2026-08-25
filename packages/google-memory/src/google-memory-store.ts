import {
  MemoryDomainError,
  STORE_UNAVAILABLE_REASON,
  UNTRUSTED_MEMORY_NOTICE,
} from '@enterprise-memory/core';

import { memoryBankBaseUrl, memoryBankParent } from './config.js';
import {
  generateMemoriesBody,
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
        const body = await requestJson(input, 'POST', `${base}/v1beta1/${parent}/memories:retrieve`, retrieveMemoriesBody(query));
        return {
          status: 'ok',
          memories: parseRetrievedMemories(body, query.principal),
          notice: UNTRUSTED_MEMORY_NOTICE,
        };
      } catch {
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
      const parsed = isObject(resource) ? parseMemoryResource(resource, rememberInput.principal) : undefined;
      if (parsed === undefined) {
        throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
      }
      return parsed;
    },

    async forget(id: MemoryId, _principal: Principal): Promise<void> {
      const name = `${parent}/memories/${id}`;
      await requestJson(input, 'DELETE', `${base}/v1beta1/${name}`);
    },

    async history(id: MemoryId, _principal: Principal): Promise<HistoryOutcome> {
      try {
        const name = `${parent}/memories/${id}`;
        const body = await requestJson(input, 'GET', `${base}/v1beta1/${name}/revisions`);
        return { status: 'ok', revisions: parseRevisions(body, id) };
      } catch {
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
      } catch {
        return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
      }
    },
  };
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
  return (await response.json());
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
