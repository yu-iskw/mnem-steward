import {
  assertMemoryId,
  isMemoryDomainError,
  MemoryDomainError,
  STORE_UNAVAILABLE_REASON,
  UNTRUSTED_MEMORY_NOTICE,
} from '@mnem-steward/core';

import { memoryBankBaseUrl, memoryBankParent } from './config.js';
import {
  generateMemoriesBody,
  isObject,
  memoryRecordFromDeletedGenerate,
  ownerFromMemory,
  parseGeneratedMemories,
  parseMemoryResource,
  parseProfile,
  parseRetrievedMemories,
  parseRevisions,
  patchExpireTimeBody,
  retrieveMemoriesBody,
  retrieveProfilesBody,
  selectLiveGeneratedMemory,
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
} from '@mnem-steward/core';

export function createGoogleMemoryStore(input: {
  config: GoogleMemoryConfig;
  http: HttpClient;
  tokens: AccessTokenProvider;
  sleep?: (ms: number) => Promise<void>;
  logError?: (message: string) => void;
}): MemoryStore {
  const parent = memoryBankParent(input.config);
  const base = memoryBankBaseUrl(input.config.location);
  const logError = input.logError ?? defaultLogError;

  return {
    async search(query: MemorySearchQuery): Promise<SearchOutcome> {
      try {
        const body = await requestJson(
          input,
          'POST',
          `${base}/v1beta1/${parent}/memories:retrieve`,
          retrieveMemoriesBody(query),
          logError,
        );
        const memories = parseRetrievedMemories(body, query.principal);
        if (memories === undefined) {
          return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
        }
        const filtered =
          query.kind === undefined
            ? memories
            : memories.filter((record) => record.kind === query.kind);
        return {
          status: 'ok',
          memories: filtered,
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
        logError,
      );
      const done = await awaitOperation(input, base, operation, logError);
      const generated = parseGeneratedMemories(done);
      if (generated.length === 0) {
        throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
      }

      const live = selectLiveGeneratedMemory(generated);
      if (live === undefined) {
        // DELETED-only: GET would 404; return input-shaped record (consolidation, not outage).
        const deleted = generated.find((item) => item.action === 'DELETED');
        if (deleted === undefined) {
          throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
        }
        return memoryRecordFromDeletedGenerate(deleted.name, rememberInput);
      }

      const resource = await requestJson(
        input,
        'GET',
        `${base}/v1beta1/${live.name}`,
        undefined,
        logError,
      );
      const parsed = isObject(resource)
        ? parseMemoryResource(resource, rememberInput.principal)
        : undefined;
      if (parsed === undefined) {
        throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
      }

      const expireAt =
        rememberInput.ttl !== undefined && 'expireAt' in rememberInput.ttl
          ? rememberInput.ttl.expireAt
          : undefined;
      if (expireAt !== undefined) {
        const withTtl = await tryPatchExpireTime(
          input,
          base,
          live.name,
          expireAt,
          rememberInput.principal,
          logError,
        );
        if (withTtl !== undefined) {
          return withTtl;
        }
        return { ...parsed, expireAt };
      }
      return parsed;
    },

    async forget(id: MemoryId, principal: Principal): Promise<void> {
      await requireOwnedMemory(input, base, parent, id, principal, logError);
      await requestJson(input, 'DELETE', memoryResourceUrl(base, parent, id), undefined, logError);
    },

    async history(id: MemoryId, principal: Principal): Promise<HistoryOutcome> {
      try {
        await requireOwnedMemory(input, base, parent, id, principal, logError);
        const body = await requestJson(
          input,
          'GET',
          `${memoryResourceUrl(base, parent, id)}/revisions`,
          undefined,
          logError,
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
          logError,
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

async function tryPatchExpireTime(
  input: {
    http: HttpClient;
    tokens: AccessTokenProvider;
    sleep?: (ms: number) => Promise<void>;
  },
  base: string,
  memoryName: string,
  expireAt: string,
  principal: Principal,
  logError: (message: string) => void,
): Promise<MemoryRecord | undefined> {
  try {
    const operation = await requestJson(
      input,
      'PATCH',
      `${base}/v1beta1/${memoryName}?updateMask=expireTime`,
      patchExpireTimeBody(expireAt),
      logError,
    );
    await awaitOperation(input, base, operation, logError);
    const resource = await requestJson(
      input,
      'GET',
      `${base}/v1beta1/${memoryName}`,
      undefined,
      logError,
    );
    if (!isObject(resource)) {
      return undefined;
    }
    return parseMemoryResource(resource, principal);
  } catch (error) {
    // Fail-open on TTL persist: remember still succeeds with control-plane expireAt.
    if (error instanceof Error) {
      logError(`google-memory PATCH expireTime skipped: ${error.message}`);
    }
    return undefined;
  }
}

async function requireOwnedMemory(
  input: { http: HttpClient; tokens: AccessTokenProvider },
  base: string,
  parent: string,
  id: MemoryId,
  principal: Principal,
  logError: (message: string) => void,
): Promise<void> {
  const resource = await requestJson(
    input,
    'GET',
    memoryResourceUrl(base, parent, id),
    undefined,
    logError,
  );
  if (!isObject(resource) || ownerFromMemory(resource) !== principal.id) {
    throw new MemoryDomainError('not_found', 'Memory not found');
  }
}

function memoryResourceUrl(base: string, parent: string, id: MemoryId): string {
  return `${base}/v1beta1/${parent}/memories/${encodeURIComponent(assertMemoryId(id))}`;
}

const OPERATION_POLL_ATTEMPTS = 40;
const OPERATION_POLL_DELAY_MS = 250;

async function awaitOperation(
  input: {
    http: HttpClient;
    tokens: AccessTokenProvider;
    sleep?: (ms: number) => Promise<void>;
  },
  base: string,
  operation: unknown,
  logError: (message: string) => void,
): Promise<unknown> {
  if (isCompletedOperation(operation)) {
    return completedOperationResult(operation);
  }
  const name =
    isObject(operation) && typeof operation['name'] === 'string' ? operation['name'] : undefined;
  if (name === undefined) {
    // Synchronous resource or already-unwrapped generate response.
    if (isObject(operation) && Array.isArray(operation['generatedMemories'])) {
      return operation;
    }
    throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
  }
  const sleep = input.sleep ?? defaultSleep;
  for (let attempt = 0; attempt < OPERATION_POLL_ATTEMPTS; attempt += 1) {
    await sleep(OPERATION_POLL_DELAY_MS);
    const body = await requestJson(input, 'GET', `${base}/v1beta1/${name}`, undefined, logError);
    if (isCompletedOperation(body)) {
      return completedOperationResult(body);
    }
  }
  throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
}

function isCompletedOperation(value: unknown): boolean {
  return isObject(value) && value['done'] === true;
}

function completedOperationResult(value: unknown): unknown {
  return isObject(value) ? (value['response'] ?? value) : value;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function defaultLogError(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function requestJson(
  input: { http: HttpClient; tokens: AccessTokenProvider },
  method: string,
  url: string,
  body: unknown,
  logError: (message: string) => void,
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
    const detail = await readErrorDetail(response);
    logError(`google-memory-http-${String(response.status)}: ${detail}`);
    throw new Error(`google-memory-http-${String(response.status)}`);
  }
  if (response.status === 204) {
    return {};
  }
  return response.json();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body['error'])) {
      const message = body['error']['message'];
      if (typeof message === 'string' && message.trim() !== '') {
        return message.length > 300 ? `${message.slice(0, 300)}…` : message;
      }
    }
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return response.statusText || 'unknown';
  }
}
