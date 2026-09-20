import { describe, expect, test, beforeEach } from 'bun:test';
import { SimplisafeMonitor } from '../src/monitor';
import type { GmailService } from '../src/service/gmail.service';
import type { ArmResult, ArmState, ArmTarget } from '../src/lib/arm-target';

let applied: string[];
let sent: { to: string; subject: string; body: string }[];
let deliver: (subject: string) => Promise<void>;

function target(name: string, failing = false): ArmTarget {
  return {
    name,
    async apply(state: ArmState): Promise<ArmResult[]> {
      applied.push(`${name}:${state}`);
      return [failing ? { name, ok: false, error: 'unreachable' } : { name, ok: true }];
    },
  };
}

/** A target whose apply() rejects outright, as an all-networks failure does. */
const throwingTarget: ArmTarget = {
  name: 'broken',
  async apply(): Promise<ArmResult[]> { throw new Error('everything failed'); },
};

function fakeGmail(sendFails = false): GmailService {
  return {
    async watchInbox(_from: string, handler: (subject: string, body: string) => Promise<void>) {
      deliver = (subject: string) => handler(subject, '');
    },
    async sendEmail(to: string, subject: string, body: string) {
      if (sendFails) throw new Error('smtp down');
      sent.push({ to, subject, body });
    },
  } as unknown as GmailService;
}

interface StartOptions {
  targets?: ArmTarget[];
  notifyEmail?: string;
  gmail?: GmailService;
}

async function start(options: StartOptions = {}) {
  const monitor = new SimplisafeMonitor({
    gmail: options.gmail ?? fakeGmail(),
    targets: options.targets ?? [target('Indoors'), target('Outdoors')],
    notifyEmail: options.notifyEmail,
  });
  await monitor.start();
  return monitor;
}

beforeEach(() => { applied = []; sent = []; });

describe('subject handling', () => {
  test('both armed subjects arm every target', async () => {
    await start();
    await deliver('SimpliSafe System Armed (home mode)');
    expect(applied).toEqual(['Indoors:armed', 'Outdoors:armed']);

    applied = [];
    await deliver('SimpliSafe System Armed (away mode)');
    expect(applied).toEqual(['Indoors:armed', 'Outdoors:armed']);
  });

  test('the disarmed subject disarms every target', async () => {
    await start();
    await deliver('SimpliSafe System Disarmed');
    expect(applied).toEqual(['Indoors:disarmed', 'Outdoors:disarmed']);
  });

  test('an unrelated subject does nothing', async () => {
    await start();
    await deliver('SimpliSafe Camera Motion Detected');
    expect(applied).toEqual([]);
    expect(sent).toEqual([]);
  });

  // The old substring check set both flags here and armed; neither should fire.
  test('a subject containing both words is ignored rather than armed', async () => {
    await start();
    await deliver('SimpliSafe System Armed and Disarmed');
    expect(applied).toEqual([]);
  });
});

describe('notifications', () => {
  test('are not sent when no address is configured', async () => {
    await start({ notifyEmail: undefined });
    await deliver('SimpliSafe System Armed (home mode)');

    expect(applied).toEqual(['Indoors:armed', 'Outdoors:armed']);
    expect(sent).toEqual([]);
  });

  test('go to the configured address when one is set', async () => {
    await start({ notifyEmail: 'alerts@example.com' });
    await deliver('SimpliSafe System Armed (home mode)');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('alerts@example.com');
    expect(sent[0]!.subject).toBe('Synced Simplisafe -> Blink');
    expect(sent[0]!.body).toContain('Indoors: ok');
  });

  test('report a partial failure distinctly', async () => {
    await start({ notifyEmail: 'a@b.com', targets: [target('Indoors'), target('Outdoors', true)] });
    await deliver('SimpliSafe System Disarmed');

    expect(sent[0]!.subject).toBe('Partially synced Simplisafe -> Blink');
    expect(sent[0]!.body).toContain('Indoors: ok');
    expect(sent[0]!.body).toContain('Outdoors: FAILED (unreachable)');
  });

  test('a thrown sync is reported', async () => {
    await start({ notifyEmail: 'a@b.com', targets: [throwingTarget] });
    await deliver('SimpliSafe System Armed (home mode)');

    expect(sent[0]!.subject).toBe('Sync Failed Simplisafe -> Blink');
    expect(sent[0]!.body).toContain('everything failed');
  });

  test('a failing sync with notifications off does not throw', async () => {
    await start({ targets: [throwingTarget] });
    expect(deliver('SimpliSafe System Armed (home mode)')).resolves.toBeUndefined();
  });

  // Losing the notification must not take the process down with it.
  test('a broken mail server does not break the sync', async () => {
    await start({ gmail: fakeGmail(true), notifyEmail: 'a@b.com' });
    await deliver('SimpliSafe System Armed (home mode)');

    expect(applied).toEqual(['Indoors:armed', 'Outdoors:armed']);
  });
});
