import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlinkService } from '../src/service/blink.service';
import { clearBlinkAuth, readBlinkAuth } from '../src/lib/blink-auth-store';

const NETWORKS = [
  { id: 1, name: 'Indoors', armed: false },
  { id: 2, name: 'Outdoors', armed: false },
  { id: 3, name: 'Garage', armed: false },
];

const reply = (body: unknown, ok = true, status = 200) => ({
  ok, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
}) as unknown as Response;

const loginReply = () => reply({
  account: {
    account_id: 'acc', user_id: 'u', client_id: 'cid',
    client_verification_required: false, tier: 'prod',
  },
  auth: { token: 'token-1' },
});

let dir: string;
let originalFetch: typeof fetch;
/** Bodies posted to /account/login, to assert on the reauth flag. */
let loginBodies: Record<string, unknown>[];

function stubFetch(onArm: (url: string) => Response = () => reply({})) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes('/account/login')) {
      loginBodies.push(JSON.parse(String(init?.body)));
      return loginReply();
    }
    if (url.endsWith('/networks')) return reply({ networks: NETWORKS });
    return onArm(url);
  }) as unknown as typeof fetch;
}

const service = (networks: string[]) =>
  new BlinkService({ email: 'e', password: 'p', clientId: 'client-A', networks });

async function connected(networks: string[]) {
  const blink = service(networks);
  await blink.login();
  await blink.resolveNetworks();
  return blink;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  loginBodies = [];
  dir = mkdtempSync(join(tmpdir(), 'iot-sync-blink-'));
  process.env.BLINK_AUTH_PATH = join(dir, '.blink-auth.json');
  for (const network of NETWORKS) network.armed = false;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BLINK_AUTH_PATH;
});

describe('resolving networks', () => {
  test('resolves every configured name', async () => {
    stubFetch();
    const blink = await connected(['Indoors', 'Outdoors']);
    expect((await blink.apply('armed')).map(_ => _.name)).toEqual(['Indoors', 'Outdoors']);
  });

  test('matches names case-insensitively and ignores surrounding space', async () => {
    stubFetch();
    const blink = await connected(['  indoors ']);
    expect((await blink.apply('armed'))[0]!.name).toBe('Indoors');
  });

  test('an unknown name fails listing what is available', async () => {
    stubFetch();
    const blink = service(['Indoors', 'Basement']);
    await blink.login();

    await expect(blink.resolveNetworks()).rejects.toThrow(
      /not found on this Blink account: Basement\. Available: Indoors, Outdoors, Garage/,
    );
  });

  test('arming before resolving is refused', async () => {
    stubFetch();
    const blink = service(['Indoors']);
    await blink.login();
    await expect(blink.apply('armed')).rejects.toThrow(/resolveNetworks/);
  });
});

describe('arming multiple networks', () => {
  test('arms every configured network', async () => {
    const armed: string[] = [];
    stubFetch(url => { armed.push(url.split('/').slice(-2).join('/')); return reply({}); });

    const blink = await connected(['Indoors', 'Outdoors', 'Garage']);
    const results = await blink.apply('armed');

    expect(armed).toEqual(['1/arm', '2/arm', '3/arm']);
    expect(results.every(_ => _.ok)).toBe(true);
  });

  test('disarm hits the disarm endpoint', async () => {
    const seen: string[] = [];
    stubFetch(url => { seen.push(url); return reply({}); });

    const blink = await connected(['Indoors']);
    await blink.apply('disarmed');
    expect(seen[0]).toMatch(/\/network\/1\/disarm$/);
  });

  test('one failing network does not stop the others', async () => {
    stubFetch(url => (url.includes('/network/2/') ? reply({ message: 'boom' }, false, 500) : reply({})));

    const blink = await connected(['Indoors', 'Outdoors', 'Garage']);
    const results = await blink.apply('disarmed');

    expect(results.filter(_ => _.ok).map(_ => _.name)).toEqual(['Indoors', 'Garage']);
    const failure = results.find(_ => !_.ok)!;
    expect(failure.name).toBe('Outdoors');
    expect(failure.error).toContain('500');
  });

  test('throws only when every network fails', async () => {
    stubFetch(() => reply({ message: 'nope' }, false, 500));
    const blink = await connected(['Indoors', 'Outdoors']);
    await expect(blink.apply('armed')).rejects.toThrow(/Failed to arm every network/);
  });
});

describe('token persistence', () => {
  test('first login does not request reauth, and stores the token', async () => {
    stubFetch();
    clearBlinkAuth();
    await service([]).login();

    expect(loginBodies[0]!.reauth).toBe(false);
    expect(readBlinkAuth('client-A')?.token).toBe('token-1');
  });

  test('a later login reuses the stored verification', async () => {
    stubFetch();
    clearBlinkAuth();
    await service([]).login();
    await service([]).login();

    expect(loginBodies[1]!.reauth).toBe(true);
  });

  test('a different client id cannot reuse the record', async () => {
    stubFetch();
    clearBlinkAuth();
    await service([]).login();

    expect(readBlinkAuth('client-B')).toBeUndefined();
    await new BlinkService({ email: 'e', password: 'p', clientId: 'client-B', networks: [] }).login();
    expect(loginBodies[1]!.reauth).toBe(false);
  });

  test('a failed login surfaces the status', async () => {
    globalThis.fetch = (async () => reply({ message: 'bad' }, false, 401)) as unknown as typeof fetch;
    await expect(service([]).login()).rejects.toThrow(/401/);
  });
});
