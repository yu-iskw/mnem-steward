import type { MemoryContext, MemoryBankScope, Principal } from './types.js';

export function toMemoryBankScope(context: MemoryContext, principal: Principal): MemoryBankScope {
  switch (context) {
    case 'personal':
      return { namespace: 'personal', principal_id: principal.id };
    case 'current_project':
      return { namespace: 'project' };
    default: {
      const exhaustive: never = context;
      return exhaustive;
    }
  }
}
