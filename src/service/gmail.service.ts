import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';
import { simpleParser } from 'mailparser';
import { LoggerService } from './logger.service';

export interface GmailCredentials {
  email: string;
  appPassword: string;
}

type EmailHandler = (subject: string, body: string) => Promise<void> | void;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

export class GmailService {
  private readonly logger = new LoggerService('GmailService');

  private client: ImapFlow | null = null;
  private transporter: Transporter | null = null;

  private watching: { from: string; handler: EmailHandler } | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private draining = false;
  private drainQueued = false;

  constructor(private readonly credentials: GmailCredentials) {}

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.credentials.email, pass: this.credentials.appPassword },
      logger: false,
    });
  }

  async login(): Promise<void> {
    this.logger.info(`Signing in as ${this.credentials.email}`);
    this.client = this.createClient();
    this.client.on('error', error => this.logger.error(`IMAP error: ${error.message}`));
    await this.client.connect();
    this.logger.info(`Successfully signed into ${this.credentials.email}`);
  }

  /** Verifies the SMTP half of the credentials without sending anything. */
  async verifyTransport(): Promise<void> {
    await this.getTransporter().verify();
  }

  /**
   * Watches the inbox for unread mail from `from` and hands each message to
   * `handler` in the order it arrived.
   */
  async watchInbox(from: string, handler: EmailHandler): Promise<void> {
    if (!this.client) throw new Error('Email connection not established');

    this.watching = { from, handler };
    this.stopped = false;

    this.client.on('exists', () => {
      void this.drain();
    });
    this.client.on('close', () => {
      if (!this.stopped) void this.reconnect();
    });

    this.logger.info('Monitoring inbox');

    // Catch up on anything that arrived while the process was down.
    await this.drain();
  }

  /**
   * Processes every matching unread message oldest first, marking each seen
   * only once its handler has resolved.
   *
   * Marking after the fact means a crash mid-handler leaves the message unread
   * and it is retried on the next start, rather than being silently consumed.
   */
  private async drain(): Promise<void> {
    if (!this.client || !this.watching) return;

    // Mail arriving mid-drain would otherwise be dropped by the guard, so the
    // event is remembered and replayed once the current pass finishes.
    if (this.draining) {
      this.drainQueued = true;
      return;
    }

    this.draining = true;
    const { from, handler } = this.watching;

    try {
      const lock = await this.client.getMailboxLock('INBOX');
      try {
        const found = await this.client.search({ seen: false, from });
        const uids = Array.isArray(found) ? [...found].sort((a, b) => a - b) : [];

        if (uids.length === 0) {
          this.logger.debug('No new emails found');
          return;
        }

        this.logger.info(`Processing ${uids.length} new email(s)`);

        for (const uid of uids) {
          const message = await this.client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!message || !message.source) continue;

          const parsed = await simpleParser(message.source);
          const subject = parsed.subject ?? '';
          const body = parsed.text ?? '';

          this.logger.info(`Email subject: ${subject}`);
          await handler(subject, body);

          await this.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      this.logger.error(`Failed to process inbox: ${error}`);
    } finally {
      this.draining = false;
    }

    if (this.drainQueued && !this.stopped) {
      this.drainQueued = false;
      await this.drain();
    }
  }

  /** Reconnects with capped exponential backoff after a dropped socket. */
  private async reconnect(): Promise<void> {
    if (this.stopped || !this.watching) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    this.logger.warn(`IMAP connection closed, reconnecting in ${Math.round(delay / 1000)}s`);

    await new Promise(resolve => setTimeout(resolve, delay));
    if (this.stopped) return;

    try {
      const { from, handler } = this.watching;
      await this.login();
      await this.watchInbox(from, handler);
      this.reconnectAttempts = 0;
    } catch (error) {
      this.logger.error(`Reconnect failed: ${error}`);
      void this.reconnect();
    }
  }

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: this.credentials.email, pass: this.credentials.appPassword },
    });
    return this.transporter;
  }

  async sendEmail(recipient: string, subject: string, body: string): Promise<void> {
    try {
      this.logger.info(`Sending email to ${recipient}`);
      await this.getTransporter().sendMail({
        from: this.credentials.email,
        to: recipient,
        subject,
        text: body,
      });
    } catch (error) {
      this.logger.error(`Failed to send email to ${recipient} due to ${error}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.transporter?.close();
    if (!this.client) return;

    try {
      await this.client.logout();
    } catch {
      // Already gone; nothing to clean up.
    }
    this.client = null;
  }
}
