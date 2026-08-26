export function parseProfileField(
  fact: string,
): { readonly key: string; readonly value: string } | undefined {
  const trimmed = fact.trim();
  const separatorIndex = indexOfSeparator(trimmed);
  if (separatorIndex <= 0) {
    return undefined;
  }
  const key = trimmed.slice(0, separatorIndex).trimEnd();
  const value = trimmed.slice(separatorIndex + 1).trim();
  if (!isProfileKey(key) || value === '') {
    return undefined;
  }
  return { key, value };
}

function indexOfSeparator(text: string): number {
  const colon = text.indexOf(':');
  const equals = text.indexOf('=');
  if (colon === -1) {
    return equals;
  }
  if (equals === -1) {
    return colon;
  }
  return Math.min(colon, equals);
}

function isProfileKey(key: string): boolean {
  if (key.length === 0) {
    return false;
  }
  for (const char of key) {
    if (!isProfileKeyChar(char)) {
      return false;
    }
  }
  return true;
}

function isProfileKeyChar(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  const isDigit = code >= 48 && code <= 57;
  const isUpper = code >= 65 && code <= 90;
  const isLower = code >= 97 && code <= 122;
  return isDigit || isUpper || isLower || char === '_' || char === '.' || char === '-';
}
