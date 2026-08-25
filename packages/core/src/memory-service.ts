import { assertPersistableClassification } from './classification.js';
import { normalizeSearchLimit, STORE_UNAVAILABLE_REASON, UNTRUSTED_MEMORY_NOTICE } from './constants.js';
import { isMemoryDomainError, MemoryDomainError } from './errors.js';
import { assertMemoryId } from './ids.js';
import { assertPersonalContext, assertScope } from './policy.js';
import { scanSecrets } from './scan-secrets.js';
import { resolveExpireAt } from './ttl.js';

import type { Clock } from './clock.js';
import type { AuditSink, MemoryStore } from './ports.js';
import type {
  AuditEvent,
  CallContext,
  HistoryOutcome,
  MemoryId,
  MemoryRecord,
  MemorySearchQuery,
  Principal,
  ProfileOutcome,
  ProfileSchemaId,
  Protocol,
  RememberInput,
  SearchOutcome,
} from './types.js';

export type MemoryService = {
  search(query: MemorySearchQuery, call?: CallContext): Promise<SearchOutcome>;
  remember(input: RememberInput, call?: CallContext): Promise<MemoryRecord>;
  forget(id: MemoryId, principal: Principal, call?: CallContext): Promise<void>;
  history(id: MemoryId, principal: Principal, call?: CallContext): Promise<HistoryOutcome>;
  getProfile(
    schema: ProfileSchemaId,
    principal: Principal,
    call?: CallContext,
  ): Promise<ProfileOutcome>;
};

export function createMemoryService(deps: {
  store: MemoryStore;
  audit: AuditSink;
  clock: Clock;
}): MemoryService {
  return {
    search: (query, call) => searchMemories(deps, query, protocolOf(call)),
    remember: (input, call) => rememberMemory(deps, input, protocolOf(call)),
    forget: (id, principal, call) => forgetMemory(deps, id, principal, protocolOf(call)),
    history: (id, principal, call) => historyOf(deps, id, principal, protocolOf(call)),
    getProfile: (schema, principal, call) => profileOf(deps, schema, principal, protocolOf(call)),
  };
}

function protocolOf(call: CallContext | undefined): Protocol {
  return call?.protocol ?? 'rest';
}

async function searchMemories(
  deps: { store: MemoryStore; audit: AuditSink; clock: Clock },
  query: MemorySearchQuery,
  protocol: Protocol,
): Promise<SearchOutcome> {
  try {
    assertScope(query.principal, 'search');
    assertPersonalContext(query.context);
  } catch (error) {
    await deny(deps, query.principal, 'search', protocol, error);
    throw error;
  }
  try {
    const outcome = await deps.store.search({
      ...query,
      limit: normalizeSearchLimit(query.limit),
    });
    if (outcome.status === 'unavailable') {
      await record(deps, query.principal, 'search', 'unavailable', protocol);
      return outcome;
    }
    await record(deps, query.principal, 'search', 'allow', protocol);
    return { ...outcome, notice: UNTRUSTED_MEMORY_NOTICE };
  } catch (error) {
    if (isMemoryDomainError(error)) {
      throw error;
    }
    await record(deps, query.principal, 'search', 'unavailable', protocol);
    return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
  }
}

async function rememberMemory(
  deps: { store: MemoryStore; audit: AuditSink; clock: Clock },
  input: RememberInput,
  protocol: Protocol,
): Promise<MemoryRecord> {
  try {
    assertScope(input.principal, 'remember');
    assertPersonalContext(input.context);
    assertPersistableClassification(input.classification);
    const secret = scanSecrets(input.fact);
    if (secret.hit) {
      throw new MemoryDomainError('secret_detected', `Secret pattern detected: ${secret.rule}`);
    }
    if (input.fact.trim() === '') {
      throw new MemoryDomainError('invalid_input', 'Memory fact must not be empty');
    }
  } catch (error) {
    await deny(deps, input.principal, 'remember', protocol, error);
    throw error;
  }
  const persistable: RememberInput = {
    ...input,
    ttl: { expireAt: resolveExpireAt(input.kind, deps.clock.now(), input.ttl) },
  };
  try {
    const stored = await deps.store.remember(persistable);
    await record(deps, input.principal, 'remember', 'allow', protocol, stored.id);
    return stored;
  } catch (error) {
    if (isMemoryDomainError(error)) {
      await deny(deps, input.principal, 'remember', protocol, error);
      throw error;
    }
    await deny(
      deps,
      input.principal,
      'remember',
      protocol,
      new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON),
    );
    throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
  }
}

async function forgetMemory(
  deps: { store: MemoryStore; audit: AuditSink; clock: Clock },
  id: MemoryId,
  principal: Principal,
  protocol: Protocol,
): Promise<void> {
  try {
    assertScope(principal, 'forget');
    assertMemoryId(id);
  } catch (error) {
    await deny(deps, principal, 'forget', protocol, error);
    throw error;
  }
  try {
    await deps.store.forget(id, principal);
    await record(deps, principal, 'forget', 'allow', protocol, id);
  } catch (error) {
    await deny(deps, principal, 'forget', protocol, error, id);
    if (isMemoryDomainError(error)) {
      throw error;
    }
    throw new MemoryDomainError('unavailable', STORE_UNAVAILABLE_REASON);
  }
}

async function historyOf(
  deps: { store: MemoryStore; audit: AuditSink; clock: Clock },
  id: MemoryId,
  principal: Principal,
  protocol: Protocol,
): Promise<HistoryOutcome> {
  try {
    assertScope(principal, 'history');
    assertMemoryId(id);
  } catch (error) {
    await deny(deps, principal, 'history', protocol, error, id);
    throw error;
  }
  try {
    const outcome = await deps.store.history(id, principal);
    if (outcome.status === 'unavailable') {
      await record(deps, principal, 'history', 'unavailable', protocol, id);
      return outcome;
    }
    await record(deps, principal, 'history', 'allow', protocol, id);
    return outcome;
  } catch (error) {
    if (isMemoryDomainError(error)) {
      await deny(deps, principal, 'history', protocol, error, id);
      throw error;
    }
    await record(deps, principal, 'history', 'unavailable', protocol, id);
    return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
  }
}

async function profileOf(
  deps: { store: MemoryStore; audit: AuditSink; clock: Clock },
  schema: ProfileSchemaId,
  principal: Principal,
  protocol: Protocol,
): Promise<ProfileOutcome> {
  try {
    assertScope(principal, 'profile_get');
  } catch (error) {
    await deny(deps, principal, 'profile_get', protocol, error);
    throw error;
  }
  try {
    const outcome = await deps.store.getProfile(schema, principal);
    if (outcome.status === 'unavailable') {
      await record(deps, principal, 'profile_get', 'unavailable', protocol);
      return outcome;
    }
    await record(deps, principal, 'profile_get', 'allow', protocol);
    return { ...outcome, notice: UNTRUSTED_MEMORY_NOTICE };
  } catch (error) {
    if (isMemoryDomainError(error)) {
      await deny(deps, principal, 'profile_get', protocol, error);
      throw error;
    }
    await record(deps, principal, 'profile_get', 'unavailable', protocol);
    return { status: 'unavailable', reason: STORE_UNAVAILABLE_REASON };
  }
}

async function deny(
  deps: { audit: AuditSink; clock: Clock },
  principal: Principal,
  action: AuditEvent['action'],
  protocol: Protocol,
  error: unknown,
  memoryId?: MemoryId,
): Promise<void> {
  const outcome = isMemoryDomainError(error) && error.code === 'unavailable' ? 'unavailable' : 'deny';
  await record(deps, principal, action, outcome, protocol, memoryId);
}

async function record(
  deps: { audit: AuditSink; clock: Clock },
  principal: Principal,
  action: AuditEvent['action'],
  outcome: AuditEvent['outcome'],
  protocol: Protocol,
  memoryId?: MemoryId,
): Promise<void> {
  await deps.audit.record({
    timestamp: deps.clock.now().toISOString(),
    actor: principal.id,
    action,
    outcome,
    namespace: 'personal',
    memoryId,
    protocol,
  });
}
