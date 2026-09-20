import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const SECRET_MODE = 0o600;

/**
 * Parses a .env file into an ordered map, preserving keys we do not manage so
 * that rewriting the file never drops the user's own additions.
 */
export function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!key) continue;

    values.set(key, deserialise(trimmed.slice(separator + 1).trim()));
  }

  return values;
}

/** Quotes only when the value would otherwise be re-parsed incorrectly. */
function serialise(value: string): string {
  return /[\s"'#]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Inverse of `serialise`.
 *
 * Double quoted values go back through JSON so that an escaped quote inside a
 * password survives a read/write round trip; stripping the outer quotes alone
 * would leave the backslash behind.
 */
function deserialise(value: string): string {
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Writes the file atomically and owner-only, backing up any previous version.
 * The temp file is created with the restricted mode before the rename so the
 * secrets are never briefly world readable.
 */
export function writeEnvFile(path: string, values: Map<string, string>): void {
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
    chmodSync(`${path}.bak`, SECRET_MODE);
  }

  const body = [...values].map(([key, value]) => `${key}=${serialise(value)}`).join('\n');
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${body}\n`, { mode: SECRET_MODE });
  chmodSync(temp, SECRET_MODE);
  renameSync(temp, path);
}
