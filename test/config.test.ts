import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseNetworks } from '../src/config';

const MANAGED = [
  'GMAIL_EMAIL', 'GMAIL_PASS', 'BLINK_EMAIL', 'BLINK_PASS',
  'BLINK_CLIENT', 'BLINK_NETWORKS', 'BLINK_NETWORK', 'NOTIFY_EMAIL',
];

const COMPLETE = {
  GMAIL_EMAIL: 'watch@gmail.com',
  GMAIL_PASS: 'app-password',
  BLINK_EMAIL: 'me@blink.com',
  BLINK_PASS: 'secret',
  BLINK_CLIENT: 'client-id',
  BLINK_NETWORKS: 'Indoors,Outdoors',
};

let dir: string;
let originalCwd: string;

// Run from an empty directory so the developer's own .env cannot leak in.
beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'iot-sync-config-'));
  process.chdir(dir);
  for (const key of MANAGED) delete process.env[key];
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
  for (const key of MANAGED) delete process.env[key];
});

describe('parseNetworks', () => {
  test('trims and drops blanks', () => {
    expect(parseNetworks(' Indoors , ,Outdoors ')).toEqual(['Indoors', 'Outdoors']);
  });

  test('treats missing or empty as none', () => {
    expect(parseNetworks(undefined)).toEqual([]);
    expect(parseNetworks('  ')).toEqual([]);
  });
});

describe('loadConfig', () => {
  test('reports every missing key at once, not just the first', () => {
    expect(() => loadConfig()).toThrow(
      /GMAIL_EMAIL, GMAIL_PASS, BLINK_EMAIL, BLINK_PASS, BLINK_CLIENT, BLINK_NETWORKS/,
    );
  });

  test('points at the setup command', () => {
    expect(() => loadConfig()).toThrow(/bun run setup/);
  });

  test('builds config when complete', () => {
    Object.assign(process.env, COMPLETE);
    const config = loadConfig();

    expect(config.gmail).toEqual({ email: 'watch@gmail.com', appPassword: 'app-password' });
    expect(config.blink.networks).toEqual(['Indoors', 'Outdoors']);
    expect(config.blink.clientId).toBe('client-id');
  });

  test('accepts the legacy singular BLINK_NETWORK', () => {
    Object.assign(process.env, { ...COMPLETE, BLINK_NETWORKS: undefined });
    delete process.env.BLINK_NETWORKS;
    process.env.BLINK_NETWORK = 'Indoors';

    expect(loadConfig().blink.networks).toEqual(['Indoors']);
  });

  test('BLINK_NETWORKS wins over the legacy key', () => {
    Object.assign(process.env, COMPLETE, { BLINK_NETWORK: 'Ignored' });
    expect(loadConfig().blink.networks).toEqual(['Indoors', 'Outdoors']);
  });

  test('whitespace-only values count as missing', () => {
    Object.assign(process.env, COMPLETE, { BLINK_CLIENT: '   ' });
    expect(() => loadConfig()).toThrow(/BLINK_CLIENT/);
  });

  test('notifications are off when NOTIFY_EMAIL is absent or blank', () => {
    Object.assign(process.env, COMPLETE);
    expect(loadConfig().notifyEmail).toBeUndefined();

    process.env.NOTIFY_EMAIL = '   ';
    expect(loadConfig().notifyEmail).toBeUndefined();
  });

  test('notifications are on when NOTIFY_EMAIL is set', () => {
    Object.assign(process.env, COMPLETE, { NOTIFY_EMAIL: 'alerts@example.com' });
    expect(loadConfig().notifyEmail).toBe('alerts@example.com');
  });
});
