import imaps from 'imap-simple';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { LoggerService } from './logger.service';
import { GMAIL_PASS, GMAIL_EMAIL } from '../config';

class GmailService {
  private readonly logger = new LoggerService(GmailService);
  private connection: imaps.ImapSimple | null = null;

  async login() {
    try {
      this.logger.info(`Signing in as ${GMAIL_EMAIL}`)
      this.connection = await imaps.connect({
        imap: {
          user: GMAIL_EMAIL,
          password: GMAIL_PASS,
          host: 'imap.gmail.com',
          port: 993,
          tls: true,
          authTimeout: 3000,
        }
      });
      this.logger.info(`Successfully signed into ${GMAIL_EMAIL}`)
      await this.connection.openBox('INBOX');
    } catch (e: any) {
      this.logger.error(`Failed to sign into ${GMAIL_EMAIL} due to ${e}`)
      throw e;
    }
  }

  onEmailReceived(from: string, callback: (subject: string, body: string) => void) {
    try {
      this.logger.info(`Monitoring inbox`);
      if (!this.connection) throw new Error('Email connection not established');

      this.connection.on('mail', async () => {
        this.logger.info(`Email received`);

        const searchCriteria = ['UNSEEN', ['FROM', from]];
        const fetchOptions = { bodies: [''], markSeen: true };

        this.logger.info(`Checking email content`);
        const results = await this.connection!.search(searchCriteria, fetchOptions);

        if (results.length === 0) {
          this.logger.info('No new emails found');
          return;
        }

        // Sort results by UID in descending order (most recent first)
        results.sort((a, b) => b.attributes.uid - a.attributes.uid);

        // Process only the most recent email
        const mostRecentEmail = results[0];
        const raw = mostRecentEmail.parts[0].body;
        const parsed = await simpleParser(raw);

        const subject = parsed.subject || '';
        const body = parsed.text || '';

        this.logger.info(`Most recent email subject: ${subject}`);
        callback(subject, body);
      });
    } catch (e: any) {
      this.logger.error(`Failed to monitor inbox due to ${e}`);
      throw e;
    }
  }

  async sendEmail(recipient: string, subject: string, body: string) {
    try {
      this.logger.info(`Sending email to ${recipient}`)
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: GMAIL_EMAIL,
          pass: GMAIL_PASS
        }
      });
  
      await transporter.sendMail({
        from: GMAIL_EMAIL,
        to: recipient,
        subject,
        text: body
      });
    } catch (e: any) {
      this.logger.error(`Failed to send email to ${recipient} due to  ${e}`)
      throw e;
    }
  }
}

export const gmailService = new GmailService();
