import { describe, expect, test, beforeEach } from 'bun:test';
import { GmailService } from '../src/service/gmail.service';

interface StoredMessage { subject: string; seen: boolean }

let store: Map<number, StoredMessage>;
let notifyExists: () => void;

const source = (subject: string) =>
  Buffer.from(`From: no-reply@info.simplisafe.com\r\nSubject: ${subject}\r\n\r\nbody\r\n`);

/**
 * Minimal ImapFlow stand-in. `search` deliberately returns newest-first, the
 * order the real server gave, to prove the service re-orders.
 */
function fakeClient() {
  return {
    on(event: string, callback: () => void) { if (event === 'exists') notifyExists = callback; },
    async getMailboxLock() { return { release() {} }; },
    async search() {
      return [...store].filter(([, m]) => !m.seen).map(([uid]) => uid).reverse();
    },
    async fetchOne(uid: string) {
      const message = store.get(Number(uid));
      return message ? { source: source(message.subject) } : false;
    },
    async messageFlagsAdd(uid: string) {
      store.get(Number(uid))!.seen = true;
      return true;
    },
  };
}

function connect(service: GmailService) {
  (service as unknown as { client: unknown }).client = fakeClient();
}

const newService = () => new GmailService({ email: 'e', appPassword: 'p' });

beforeEach(() => { store = new Map(); });

describe('inbox draining', () => {
  test('processes a queued burst oldest first and ends in the final state', async () => {
    store.set(11, { subject: 'SimpliSafe System Armed (away mode)', seen: false });
    store.set(12, { subject: 'SimpliSafe System Disarmed', seen: false });

    const handled: string[] = [];
    const service = newService();
    connect(service);
    await service.watchInbox('no-reply@info.simplisafe.com', subject => { handled.push(subject); });

    expect(handled).toEqual([
      'SimpliSafe System Armed (away mode)',
      'SimpliSafe System Disarmed',
    ]);
    expect([...store.values()].every(_ => _.seen)).toBe(true);
  });

  // The original bug: only the newest was handled, yet all were marked read.
  test('marks a message read only after its handler has finished', async () => {
    store.set(11, { subject: 'first', seen: false });
    store.set(12, { subject: 'second', seen: false });

    const seenDuring: boolean[][] = [];
    const service = newService();
    connect(service);
    await service.watchInbox('x@y', async () => {
      seenDuring.push([...store.values()].map(_ => _.seen));
      await Promise.resolve();
    });

    expect(seenDuring[0]).toEqual([false, false]);
    expect(seenDuring[1]).toEqual([true, false]);
  });

  test('mail arriving mid-drain is still picked up', async () => {
    store.set(1, { subject: 'first', seen: false });

    const handled: string[] = [];
    const service = newService();
    connect(service);
    await service.watchInbox('x@y', async subject => {
      handled.push(subject);
      if (subject === 'first') {
        store.set(2, { subject: 'arrived-mid-drain', seen: false });
        notifyExists();
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handled).toEqual(['first', 'arrived-mid-drain']);
    expect([...store.values()].every(_ => _.seen)).toBe(true);
  });

  test('an empty inbox handles nothing', async () => {
    const handled: string[] = [];
    const service = newService();
    connect(service);
    await service.watchInbox('x@y', subject => { handled.push(subject); });
    expect(handled).toEqual([]);
  });

  // A handler that throws must leave the message unread so it is retried.
  test('a failing handler leaves the message unread', async () => {
    store.set(1, { subject: 'boom', seen: false });

    const service = newService();
    connect(service);
    await service.watchInbox('x@y', () => { throw new Error('handler blew up'); });

    expect(store.get(1)!.seen).toBe(false);
  });

  test('watching before connecting is refused', async () => {
    await expect(newService().watchInbox('x@y', () => {})).rejects.toThrow(/not established/);
  });
});
