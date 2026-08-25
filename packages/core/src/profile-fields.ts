const PROFILE_FIELD = /^(?<key>[A-Za-z0-9_.-]+)\s*[:=]\s*(?<value>.+)$/u;

export function parseProfileField(
  fact: string,
): { readonly key: string; readonly value: string } | undefined {
  const match = PROFILE_FIELD.exec(fact.trim());
  const key = match?.groups?.['key'];
  const value = match?.groups?.['value'];
  if (key === undefined || value === undefined) {
    return undefined;
  }
  return { key, value: value.trim() };
}
