import type {
  HistoryOutcome,
  MemoryRecord,
  ProfileOutcome,
  SearchOutcome,
} from '@enterprise-memory/core';

export class MemoryClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MemoryClientError';
    this.status = status;
    this.code = code;
  }
}

export type MemoryClient = {
  search(input: {
    context?: 'personal' | 'current_project';
    text?: string;
    kind?: string;
    limit?: number;
  }): Promise<SearchOutcome>;
  remember(input: {
    context?: 'personal' | 'current_project';
    kind: string;
    classification: string;
    fact: string;
  }): Promise<MemoryRecord>;
  forget(id: string): Promise<void>;
  history(id: string): Promise<HistoryOutcome>;
  getProfile(schema?: string): Promise<ProfileOutcome>;
};

export function createMemoryClient(input: {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
}): MemoryClient {
  const baseUrl = input.baseUrl.replace(/\/$/u, '');
  const fetchImpl = input.fetch ?? fetch;

  async function request(path: string, init: RequestInit): Promise<Response> {
    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
  }

  async function json<T>(path: string, init: RequestInit): Promise<T> {
    const response = await request(path, init);
    if (response.status === 204) {
      return undefined as T;
    }
    const body: unknown = await response.json();
    if (!response.ok) {
      const errorBody = asObject(body);
      const code = typeof errorBody['error'] === 'string' ? errorBody['error'] : 'http_error';
      const message = typeof errorBody['message'] === 'string' ? errorBody['message'] : response.statusText;
      throw new MemoryClientError(response.status, code, message);
    }
    return body as T;
  }

  return {
    search(searchInput) {
      return json<SearchOutcome>('/v1/memories:search', {
        method: 'POST',
        body: JSON.stringify(searchInput),
      });
    },
    remember(rememberInput) {
      return json<MemoryRecord>('/v1/memories', {
        method: 'POST',
        body: JSON.stringify(rememberInput),
      });
    },
    async forget(id) {
      await json(`/v1/memories/${id}`, { method: 'DELETE' });
    },
    history(id) {
      return json<HistoryOutcome>(`/v1/memories/${id}/history`, { method: 'GET' });
    },
    getProfile(schema = 'employee-agent') {
      return json<ProfileOutcome>(`/v1/profiles/${schema}`, { method: 'GET' });
    },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
