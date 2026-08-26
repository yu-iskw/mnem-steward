import { OAUTH_SCOPES } from './constants.js';
import { MemoryDomainError } from './errors.js';

import type { MemoryContext, MemoryKind, OAuthScope, Principal } from './types.js';

const MEMORY_KINDS: readonly MemoryKind[] = [
  'identity',
  'preference',
  'fact',
  'procedure',
  'episode',
  'relationship',
  'constraint',
  'working',
];

export function hasScope(principal: Principal, scope: OAuthScope): boolean {
  return principal.scopes.includes(scope);
}

export function isPersonalContext(context: MemoryContext): boolean {
  switch (context) {
    case 'personal':
      return true;
    case 'current_project':
      return false;
    default: {
      const exhaustive: never = context;
      return exhaustive;
    }
  }
}

export function assertPersonalContext(context: MemoryContext): void {
  if (!isPersonalContext(context)) {
    throw new MemoryDomainError(
      'namespace_denied',
      'Shared and project namespaces are denied in this milestone',
    );
  }
}

export function tryParseMemoryKind(value: string): MemoryKind | undefined {
  return MEMORY_KINDS.find((kind) => kind === value);
}

export function parseMemoryKind(value: string): MemoryKind {
  const match = tryParseMemoryKind(value);
  if (match === undefined) {
    throw new MemoryDomainError('invalid_input', `Unknown memory kind: ${value}`);
  }
  return match;
}

export function parseMemoryContext(value: unknown): MemoryContext {
  if (value === undefined || value === 'personal') {
    return 'personal';
  }
  if (value === 'current_project') {
    return 'current_project';
  }
  throw new MemoryDomainError('invalid_input', 'context must be personal or current_project');
}

export function parseOAuthScopes(scopeClaim: string | undefined): OAuthScope[] {
  if (scopeClaim === undefined || scopeClaim.trim() === '') {
    return [];
  }
  const requested = scopeClaim.split(/\s+/u);
  const allowed: OAuthScope[] = [];
  for (const token of requested) {
    const scope = OAUTH_SCOPES.find((candidate) => candidate === token);
    if (scope !== undefined) {
      allowed.push(scope);
    }
  }
  return allowed;
}

export function requiredScopeForAction(
  action: 'search' | 'remember' | 'forget' | 'history' | 'profile_get',
): OAuthScope {
  switch (action) {
    case 'search':
      return 'memory.read';
    case 'remember':
      return 'memory.write';
    case 'forget':
      return 'memory.delete';
    case 'history':
      return 'memory.history.read';
    case 'profile_get':
      return 'memory.profile.read';
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function assertScope(
  principal: Principal,
  action: 'search' | 'remember' | 'forget' | 'history' | 'profile_get',
): void {
  const scope = requiredScopeForAction(action);
  if (!hasScope(principal, scope)) {
    throw new MemoryDomainError('forbidden', `Missing required scope ${scope}`);
  }
}
