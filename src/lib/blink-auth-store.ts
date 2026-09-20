import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_MODE = 0o600;

/**
 * Resolved per call rather than at import so the location follows the working
 * directory, and so tests can point it somewhere disposable.
 */
export function blinkAuthPath(): string {
  return process.env.BLINK_AUTH_PATH?.trim() || join(process.cwd(), '.blink-auth.json');
}

export interface BlinkAuthRecord {
  /** The BLINK_CLIENT this token was issued against; a change invalidates it. */
  uniqueId: string;
  token: string;
  tier: string;
  accountId: string;
  clientId: string;
  verifiedAt: string;
}

/**
 * Returns the stored credentials when they belong to the given client id.
 *
 * Blink ties client verification to the unique_id sent at login, so a record
 * written for a different one cannot be reused and is treated as absent.
 */
export function readBlinkAuth(uniqueId: string): BlinkAuthRecord | undefined {
  const storePath = blinkAuthPath();
  if (!existsSync(storePath)) return undefined;

  try {
    const record = JSON.parse(readFileSync(storePath, 'utf8')) as Partial<BlinkAuthRecord>;
    if (!record.uniqueId || !record.token || record.uniqueId !== uniqueId) return undefined;
    return record as BlinkAuthRecord;
  } catch {
    // A corrupt store should just mean "log in again", not a crash.
    return undefined;
  }
}

export function writeBlinkAuth(record: BlinkAuthRecord): void {
  const storePath = blinkAuthPath();
  const temp = `${storePath}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: SECRET_MODE });
  chmodSync(temp, SECRET_MODE);
  renameSync(temp, storePath);
}

export function clearBlinkAuth(): void {
  rmSync(blinkAuthPath(), { force: true });
}
