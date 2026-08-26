import type {
  AuditEvent,
  HistoryOutcome,
  MemoryId,
  MemoryRecord,
  MemorySearchQuery,
  Principal,
  ProfileOutcome,
  ProfileSchemaId,
  RememberInput,
  SearchOutcome,
} from './types.js';

export interface MemoryStore {
  search(query: MemorySearchQuery): Promise<SearchOutcome>;
  remember(input: RememberInput): Promise<MemoryRecord>;
  forget(id: MemoryId, principal: Principal): Promise<void>;
  history(id: MemoryId, principal: Principal): Promise<HistoryOutcome>;
  getProfile(schema: ProfileSchemaId, principal: Principal): Promise<ProfileOutcome>;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
