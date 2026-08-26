export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
};

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export function parseJsonRpc(body: unknown): JsonRpcRequest | { error: string } {
  if (Array.isArray(body)) {
    return { error: 'Batch JSON-RPC is not supported' };
  }
  if (typeof body !== 'object' || body === null) {
    return { error: 'Invalid JSON-RPC body' };
  }
  const record = body as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown };
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
    return { error: 'Invalid JSON-RPC request' };
  }
  return {
    jsonrpc: '2.0',
    method: record.method,
    ...(record.id === undefined ? {} : { id: record.id as JsonRpcId }),
    ...(record.params === undefined ? {} : { params: record.params }),
  };
}

export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export class JsonRpcCodedError extends Error {
  readonly jsonRpcCode: number;

  constructor(jsonRpcCode: number, message: string) {
    super(message);
    this.name = 'JsonRpcCodedError';
    this.jsonRpcCode = jsonRpcCode;
  }
}

export function isJsonRpcCodedError(error: unknown): error is JsonRpcCodedError {
  return error instanceof JsonRpcCodedError;
}
