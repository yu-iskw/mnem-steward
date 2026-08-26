import { normalizeSearchLimit, UNTRUSTED_MEMORY_NOTICE } from './constants.js';
import { MemoryDomainError } from './errors.js';
import { parseProfileField } from './profile-fields.js';
import { isExpired, resolveExpireAt } from './ttl.js';

import type { Clock } from './clock.js';
import type { IdGenerator } from './ids.js';
import type { MemoryStore } from './ports.js';
import type {
  HistoryOutcome,
  MemoryId,
  MemoryRecord,
  MemoryRevision,
  MemorySearchQuery,
  Principal,
  ProfileOutcome,
  ProfileSchemaId,
  RememberInput,
  SearchOutcome,
} from './types.js';

export function createInMemoryMemoryStore(deps: { clock: Clock; ids: IdGenerator }): MemoryStore {
  const records = new Map<MemoryId, MemoryRecord>();
  const revisions = new Map<MemoryId, MemoryRevision[]>();
  const owners = new Map<MemoryId, Principal['id']>();

  return {
    search(query: MemorySearchQuery): Promise<SearchOutcome> {
      const now = deps.clock.now();
      const limit = normalizeSearchLimit(query.limit);
      const needle = query.text?.trim().toLowerCase() ?? '';
      const matches = [...records.values()].filter((record) =>
        isVisible(record, query.principal, now),
      );
      const kindFiltered = matches.filter(
        (record) => query.kind === undefined || record.kind === query.kind,
      );
      const textFiltered = kindFiltered.filter(
        (record) => needle === '' || record.fact.toLowerCase().includes(needle),
      );
      textFiltered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return Promise.resolve({
        status: 'ok',
        memories: textFiltered.slice(0, limit),
        notice: UNTRUSTED_MEMORY_NOTICE,
      });
    },

    remember(input: RememberInput): Promise<MemoryRecord> {
      const now = deps.clock.now().toISOString();
      const record: MemoryRecord = {
        id: deps.ids.nextMemoryId(),
        kind: input.kind,
        namespace: 'personal',
        principalId: input.principal.id,
        classification: input.classification,
        fact: input.fact,
        createdAt: now,
        updatedAt: now,
        expireAt: resolveExpireAt(input.kind, deps.clock.now(), input.ttl),
      };
      records.set(record.id, record);
      owners.set(record.id, input.principal.id);
      appendRevision(revisions, deps.ids, record.id, now, 'created');
      return Promise.resolve(record);
    },

    forget(id: MemoryId, principal: Principal): Promise<void> {
      const record = records.get(id);
      if (record === undefined || record.principalId !== principal.id) {
        throw new MemoryDomainError('not_found', 'Memory not found');
      }
      records.delete(id);
      const now = deps.clock.now().toISOString();
      appendRevision(revisions, deps.ids, id, now, 'deleted');
      return Promise.resolve();
    },

    history(id: MemoryId, principal: Principal): Promise<HistoryOutcome> {
      const owner = owners.get(id);
      const trail = revisions.get(id) ?? [];
      if (owner === undefined || owner !== principal.id || trail.length === 0) {
        throw new MemoryDomainError('not_found', 'Memory not found');
      }
      return Promise.resolve({ status: 'ok', revisions: trail });
    },

    getProfile(schema: ProfileSchemaId, principal: Principal): Promise<ProfileOutcome> {
      const now = deps.clock.now();
      const fields: Record<string, unknown> = {};
      for (const record of records.values()) {
        if (!isVisible(record, principal, now)) {
          continue;
        }
        if (record.kind !== 'preference' && record.kind !== 'identity') {
          continue;
        }
        const parsed = parseProfileField(record.fact);
        if (parsed !== undefined) {
          fields[parsed.key] = parsed.value;
        }
      }
      return Promise.resolve({
        status: 'ok',
        profile: { schema, principalId: principal.id, fields },
        notice: UNTRUSTED_MEMORY_NOTICE,
      });
    },
  };
}

function isVisible(record: MemoryRecord, principal: Principal, now: Date): boolean {
  return (
    record.principalId === principal.id &&
    record.namespace === 'personal' &&
    !isExpired(record.expireAt, now)
  );
}

function appendRevision(
  revisions: Map<MemoryId, MemoryRevision[]>,
  ids: IdGenerator,
  memoryId: MemoryId,
  updatedAt: string,
  action: MemoryRevision['action'],
): void {
  const current = revisions.get(memoryId) ?? [];
  current.push({
    revisionId: ids.nextRevisionId(),
    memoryId,
    updatedAt,
    action,
  });
  revisions.set(memoryId, current);
}
