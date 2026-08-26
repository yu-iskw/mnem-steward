import type { AuditSink } from './ports.js';
import type { AuditEvent } from './types.js';

export function createInMemoryAuditSink(): AuditSink & { events(): readonly AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    record(event: AuditEvent): Promise<void> {
      events.push(event);
      return Promise.resolve();
    },
    events(): readonly AuditEvent[] {
      return events;
    },
  };
}

export function createStdoutAuditSink(write = console.info): AuditSink {
  return {
    record(event: AuditEvent): Promise<void> {
      write(JSON.stringify(event));
      return Promise.resolve();
    },
  };
}
