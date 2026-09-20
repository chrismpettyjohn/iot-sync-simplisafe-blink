import { describe, expect, test } from 'bun:test';
import { stripObsoleteKeys } from '../src/setup';

describe('stripObsoleteKeys', () => {
  // Rewriting this key normalised would switch off TLS verification for real.
  test('drops NODE_TLS_REJECT_UNAUTHORIZED', () => {
    const env = new Map([['GMAIL_EMAIL', 'a@b.com'], ['NODE_TLS_REJECT_UNAUTHORIZED', '0']]);
    stripObsoleteKeys(env);

    expect(env.has('NODE_TLS_REJECT_UNAUTHORIZED')).toBe(false);
    expect(env.get('GMAIL_EMAIL')).toBe('a@b.com');
  });

  test('drops it even when written with stray whitespace', () => {
    const env = new Map([['NODE_TLS_REJECT_UNAUTHORIZED ', "'0'"]]);
    stripObsoleteKeys(env);
    expect(env.size).toBe(0);
  });

  test('drops keys superseded by BLINK_NETWORKS', () => {
    const env = new Map([
      ['BLINK_NETWORKS', 'Indoors'],
      ['BLINK_NETWORK', 'Indoors'],
      ['BLINK_VERIFIED', 'true'],
    ]);
    stripObsoleteKeys(env);

    expect([...env.keys()]).toEqual(['BLINK_NETWORKS']);
  });

  test('leaves unrelated keys alone', () => {
    const env = new Map([['CUSTOM', 'keep me'], ['NOTIFY_EMAIL', 'a@b.com']]);
    stripObsoleteKeys(env);
    expect(env.size).toBe(2);
  });
});
