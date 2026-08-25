import type { EMPLOYEE_AGENT_SCHEMA, OAUTH_SCOPES } from './constants.js';

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export type MemoryNamespace =
  | 'personal'
  | 'project'
  | 'team'
  | 'application'
  | 'organization';

export type MemoryContext = 'personal' | 'current_project';

export type PrincipalId = `usr_${string}`;

export type MemoryId = string;

export type MemoryKind =
  | 'identity'
  | 'preference'
  | 'fact'
  | 'procedure'
  | 'episode'
  | 'relationship'
  | 'constraint'
  | 'working';

export type Classification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'prohibited-for-memory';

export type Ttl = { readonly expireAt: string } | { readonly ttlSeconds: number };

export type Protocol = 'rest' | 'mcp';

export type ProfileSchemaId = typeof EMPLOYEE_AGENT_SCHEMA;

export interface Principal {
  readonly id: PrincipalId;
  readonly issuer: string;
  readonly subject: string;
  readonly scopes: readonly OAuthScope[];
}

export interface MemoryRecord {
  readonly id: MemoryId;
  readonly kind: MemoryKind;
  readonly namespace: MemoryNamespace;
  readonly principalId: PrincipalId;
  readonly classification: Classification;
  readonly fact: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expireAt?: string;
}

export interface MemoryRevision {
  readonly revisionId: string;
  readonly memoryId: MemoryId;
  readonly updatedAt: string;
  readonly action: 'created' | 'updated' | 'deleted';
}

export interface MemoryProfile {
  readonly schema: ProfileSchemaId;
  readonly principalId: PrincipalId;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type SearchOutcome =
  | {
      readonly status: 'ok';
      readonly memories: readonly MemoryRecord[];
      readonly notice: string;
    }
  | { readonly status: 'unavailable'; readonly reason: string };

export type ProfileOutcome =
  | {
      readonly status: 'ok';
      readonly profile: MemoryProfile;
      readonly notice: string;
    }
  | { readonly status: 'unavailable'; readonly reason: string };

export type HistoryOutcome =
  | { readonly status: 'ok'; readonly revisions: readonly MemoryRevision[] }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface MemoryBankScope {
  readonly namespace: MemoryNamespace;
  readonly principal_id?: PrincipalId;
  readonly project_id?: string;
  readonly team_id?: string;
  readonly application_id?: string;
  readonly organization_id?: string;
}

export interface RememberInput {
  readonly principal: Principal;
  readonly context: MemoryContext;
  readonly kind: MemoryKind;
  readonly classification: Classification;
  readonly fact: string;
  readonly ttl?: Ttl;
}

export interface MemorySearchQuery {
  readonly principal: Principal;
  readonly context: MemoryContext;
  readonly text?: string;
  readonly kind?: MemoryKind;
  readonly limit?: number;
}

export interface CallContext {
  readonly protocol: Protocol;
}

export interface AuditEvent {
  readonly timestamp: string;
  readonly actor: PrincipalId;
  readonly action: 'search' | 'remember' | 'forget' | 'history' | 'profile_get';
  readonly outcome: 'allow' | 'deny' | 'unavailable';
  readonly namespace: MemoryNamespace;
  readonly memoryId?: MemoryId;
  readonly protocol: Protocol;
}

export type DomainErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'namespace_denied'
  | 'secret_detected'
  | 'prohibited_classification'
  | 'not_found'
  | 'invalid_input'
  | 'unavailable';
