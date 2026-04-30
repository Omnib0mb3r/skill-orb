const SECRET_RE =
  /(?<key>(?:api[_-]?key|token|secret|password|authorization|credentials?|auth))(?<sep>["'\s:=]+)(?<scheme>[A-Za-z]+\s+)?(?<value>[A-Za-z0-9_\-/.+=]{8,})/gi;

export function scrubSecrets(input: string | null | undefined): string {
  if (input == null) return '';
  return String(input).replace(
    SECRET_RE,
    (_full, key: string, sep: string, scheme: string | undefined) =>
      `${key}${sep}${scheme ?? ''}[REDACTED]`,
  );
}

export function scrubObject(value: unknown): string {
  if (value == null) return '';
  const stringified =
    typeof value === 'string' ? value : safeStringify(value);
  return scrubSecrets(stringified);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
