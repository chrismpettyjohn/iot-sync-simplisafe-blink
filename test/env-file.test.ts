import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvFile, writeEnvFile } from '../src/lib/env-file';

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'iot-sync-env-'));
  envPath = join(dir, '.env');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('env file', () => {
  test('missing file reads as empty', () => {
    expect(readEnvFile(envPath).size).toBe(0);
  });

  test('round trips values, including ones needing quotes', () => {
    const written = new Map([
      ['GMAIL_EMAIL', 'a@b.com'],
      ['BLINK_NETWORKS', 'Indoors,Outdoors'],
      ['SPACED', 'two words'],
      ['HASHED', 'pa#ss'],
      ['QUOTED', 'pa"ss'],
      ['APOSTROPHE', "pa'ss"],
    ]);
    writeEnvFile(envPath, written);

    expect(readEnvFile(envPath)).toEqual(written);
  });

  test('preserves keys it does not manage', () => {
    writeEnvFile(envPath, new Map([['CUSTOM', 'keep me']]));
    expect(readEnvFile(envPath).get('CUSTOM')).toBe('keep me');
  });

  test('skips comments and blank lines', () => {
    writeEnvFile(envPath, new Map([['A', '1']]));
    const reread = readEnvFile(envPath);
    expect(reread.get('A')).toBe('1');
    expect(reread.size).toBe(1);
  });

  test('writes owner-only and backs up the previous version', () => {
    writeEnvFile(envPath, new Map([['GMAIL_EMAIL', 'first@b.com']]));
    expect(statSync(envPath).mode & 0o777).toBe(0o600);

    writeEnvFile(envPath, new Map([['GMAIL_EMAIL', 'second@b.com']]));
    expect(readEnvFile(envPath).get('GMAIL_EMAIL')).toBe('second@b.com');
    expect(readEnvFile(`${envPath}.bak`).get('GMAIL_EMAIL')).toBe('first@b.com');
    expect(statSync(`${envPath}.bak`).mode & 0o777).toBe(0o600);
  });
});
