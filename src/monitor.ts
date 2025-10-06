import { GMAIL_EMAIL } from "./config";
import { blinkService } from "./service/blink.service";
import { gmailService } from "./service/gmail.service";
import { LoggerService } from "./service/logger.service";

export class SimplisafeMonitor {
  private readonly logger = new LoggerService(SimplisafeMonitor);

  async start() {
    this.logger.info('Starting');

    await gmailService.login();
    await blinkService.login();

    gmailService.onEmailReceived('no-reply@info.simplisafe.com', async (subject) => {
      try {
        this.logger.info(`Received email ${subject}`)
        const ALLOWED_SUBJECTS = ['SimpliSafe System Armed (home mode)', 'SimpliSafe System Armed (away mode)', 'SimpliSafe System Disarmed'];
      
        if (!ALLOWED_SUBJECTS.includes(subject)) return;
      
        const shouldArm = subject.includes('Armed');
        const shouldDisarm = subject.includes('Disarmed');
      
        if (shouldArm) {
          await blinkService.armSystem();
          await gmailService.sendEmail(GMAIL_EMAIL, `Synced Simplisafe -> Blink`, 'Armed');
          return;
        }
        if (shouldDisarm) {
          await blinkService.disarmSystem();
          await gmailService.sendEmail(GMAIL_EMAIL, `Synced Simplisafe -> Blink`, 'Disarmed');
          return;
        }

        this.logger.info(`Skipping.  Not monitoring related`)
      } catch (e: any) {
        this.logger.error(`Failed to sync: ${e}`);
        gmailService.sendEmail(GMAIL_EMAIL, `Sync Failed Simplisafe -> Blink`, `${e}`);
      }
    
    });
  }
}

const simplisafeMonitor: SimplisafeMonitor = new SimplisafeMonitor();
simplisafeMonitor.start();