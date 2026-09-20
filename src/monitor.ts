import { LoggerService } from './service/logger.service';
import type { GmailService } from './service/gmail.service';
import type { ArmResult, ArmState, ArmTarget } from './lib/arm-target';

const SIMPLISAFE_SENDER = 'no-reply@info.simplisafe.com';

/**
 * Explicit subject -> state map.
 *
 * Deriving the state from substrings ("Armed" / "Disarmed") only worked
 * because "Disarmed" happens not to contain a capital-A "Armed"; a lookup
 * keeps the two cases genuinely exclusive.
 */
const SUBJECT_STATES: Record<string, ArmState> = {
  'SimpliSafe System Armed (home mode)': 'armed',
  'SimpliSafe System Armed (away mode)': 'armed',
  'SimpliSafe System Disarmed': 'disarmed',
};

export interface MonitorOptions {
  gmail: GmailService;
  targets: ArmTarget[];
  /** Omit to run without sending sync notification emails. */
  notifyEmail?: string;
}

export class SimplisafeMonitor {
  private readonly logger = new LoggerService('SimplisafeMonitor');

  constructor(private readonly options: MonitorOptions) {}

  async start(): Promise<void> {
    this.logger.info('Starting');
    this.logger.info(
      this.options.notifyEmail
        ? `Notifying ${this.options.notifyEmail} on each sync`
        : 'Notification emails disabled (no NOTIFY_EMAIL set)',
    );

    await this.options.gmail.watchInbox(SIMPLISAFE_SENDER, async subject => {
      await this.handleSubject(subject);
    });
  }

  private async handleSubject(subject: string): Promise<void> {
    const state = SUBJECT_STATES[subject];
    if (!state) {
      this.logger.info('Skipping. Not monitoring related');
      return;
    }

    try {
      const results: ArmResult[] = [];
      for (const target of this.options.targets) {
        results.push(...(await target.apply(state)));
      }

      const failed = results.filter(_ => !_.ok);
      const summary = results
        .map(_ => (_.ok ? `${_.name}: ok` : `${_.name}: FAILED (${_.error})`))
        .join('\n');

      await this.notify(
        failed.length > 0
          ? 'Partially synced Simplisafe -> Blink'
          : 'Synced Simplisafe -> Blink',
        `${state === 'armed' ? 'Armed' : 'Disarmed'}\n\n${summary}`,
      );
    } catch (error) {
      this.logger.error(`Failed to sync: ${error}`);
      await this.notify('Sync Failed Simplisafe -> Blink', `${error}`);
    }
  }

  /**
   * Sends a sync notification, unless notifications are switched off.
   *
   * Awaited rather than fire and forget so the message cannot be lost to
   * process exit, and a failure to notify never masks the sync result.
   */
  private async notify(subject: string, body: string): Promise<void> {
    const { notifyEmail, gmail } = this.options;
    if (!notifyEmail) {
      this.logger.debug(`Notifications disabled, skipping: ${subject}`);
      return;
    }

    try {
      await gmail.sendEmail(notifyEmail, subject, body);
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error}`);
    }
  }
}
