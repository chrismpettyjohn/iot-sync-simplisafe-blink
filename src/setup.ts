import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ENV_KEYS, parseNetworks } from './config';
import { readEnvFile, writeEnvFile } from './lib/env-file';
import { ask, askChoice, askSecret, closePrompts, confirm } from './lib/prompt';
import { blinkAuthPath } from './lib/blink-auth-store';
import { BlinkService } from './service/blink.service';
import { GmailService } from './service/gmail.service';

const ENV_PATH = join(process.cwd(), '.env');
const APP_PASSWORD_URL = 'https://myaccount.google.com/apppasswords';
const TOTAL_STEPS = 6;

/**
 * Keys that must not survive into the rewritten file.
 *
 * NODE_TLS_REJECT_UNAUTHORIZED disables certificate checking for every
 * connection in the process. Older .env files carry it written as
 * `NODE_TLS_REJECT_UNAUTHORIZED = '0'`, which dotenv parsed as a key with a
 * trailing space and therefore ignored; rewriting it normalised would switch
 * it on for real, so it is dropped instead.
 */
const OBSOLETE_KEYS = ['NODE_TLS_REJECT_UNAUTHORIZED', 'BLINK_NETWORK', 'BLINK_VERIFIED'];

/**
 * Removes keys that must not be carried into the rewritten file.
 *
 * Exported so the NODE_TLS_REJECT_UNAUTHORIZED case stays covered by a test:
 * silently re-enabling it would weaken every connection the process makes.
 */
export function stripObsoleteKeys(env: Map<string, string>): void {
  for (const key of OBSOLETE_KEYS) {
    env.delete(key);
    // Old files wrote `KEY = '0'`, which parses with surrounding whitespace.
    for (const existing of [...env.keys()]) {
      if (existing.trim() === key) env.delete(existing);
    }
  }
}

/**
 * IMAP failures surface as a bare "Command failed", so the server's own
 * response text is preferred where the client exposes it.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error as Error & { responseText?: string; authenticationFailed?: boolean };
  if (detail.authenticationFailed) {
    return `${detail.responseText ?? error.message} (check the app password)`;
  }
  return detail.responseText ?? error.message;
}

function heading(step: number, text: string): void {
  console.log(chalk.bold(`\n[${step}/${TOTAL_STEPS}] ${text}`));
}

/**
 * Prompts for a secret, keeping the stored value when the user just hits
 * enter, so re-running setup never requires retyping passwords.
 */
async function askSecretOrKeep(label: string, existing: string | undefined): Promise<string> {
  while (true) {
    const answer = await askSecret(label, Boolean(existing));
    if (answer) return answer;
    if (existing) return existing;
    console.log(chalk.yellow('  This value is required.'));
  }
}

/** Prompts for Gmail credentials until IMAP and SMTP both accept them. */
async function configureGmail(env: Map<string, string>): Promise<void> {
  heading(1, 'Gmail');
  console.log(chalk.gray(`  GMAIL_PASS must be an app password, not your account password.`));
  console.log(chalk.gray(`  Create one at ${APP_PASSWORD_URL}`));

  while (true) {
    const email = await ask('  Gmail address', env.get(ENV_KEYS.gmailEmail));
    if (!email) {
      console.log(chalk.yellow('  This value is required.'));
      continue;
    }

    const appPassword = await askSecretOrKeep('  Gmail app password', env.get(ENV_KEYS.gmailPass));

    const gmail = new GmailService({ email, appPassword });
    try {
      console.log(chalk.gray('  Verifying IMAP and SMTP...'));
      await gmail.login();
      await gmail.verifyTransport();
      await gmail.close();

      env.set(ENV_KEYS.gmailEmail, email);
      env.set(ENV_KEYS.gmailPass, appPassword);
      console.log(chalk.green('  Gmail verified'));
      return;
    } catch (error) {
      await gmail.close();
      console.log(chalk.red(`  Gmail verification failed: ${describeError(error)}`));
      if (!(await confirm('  Try again?'))) throw new Error('Setup cancelled');
    }
  }
}

/** Prompts for Blink credentials, logs in (handling 2FA) and returns the client. */
async function configureBlink(env: Map<string, string>): Promise<BlinkService> {
  heading(2, 'Blink');

  while (true) {
    const email = await ask('  Blink email', env.get(ENV_KEYS.blinkEmail));
    if (!email) {
      console.log(chalk.yellow('  This value is required.'));
      continue;
    }

    const password = await askSecretOrKeep('  Blink password', env.get(ENV_KEYS.blinkPass));

    // The client id is arbitrary but must stay stable: Blink ties the 2FA
    // verification to it, so a fresh one means a fresh PIN prompt.
    const clientId = await ask('  Blink client id', env.get(ENV_KEYS.blinkClient) || randomUUID());

    const blink = new BlinkService({ email, password, clientId, networks: [] });
    try {
      heading(3, 'Blink sign in (a 2FA PIN may be emailed or texted to you)');
      await blink.login();

      env.set(ENV_KEYS.blinkEmail, email);
      env.set(ENV_KEYS.blinkPass, password);
      env.set(ENV_KEYS.blinkClient, clientId);
      console.log(chalk.green(`  Blink verified, token saved to ${blinkAuthPath()}`));
      return blink;
    } catch (error) {
      console.log(chalk.red(`  Blink sign in failed: ${describeError(error)}`));
      if (!(await confirm('  Try again?'))) throw new Error('Setup cancelled');
    }
  }
}

/** Lets the user pick sync modules from the account's real network list. */
async function configureNetworks(env: Map<string, string>, blink: BlinkService): Promise<void> {
  heading(4, 'Sync modules');

  const available = await blink.listNetworks();
  if (available.length === 0) throw new Error('No Blink networks found on this account');

  const preselected = parseNetworks(env.get(ENV_KEYS.blinkNetworks) ?? env.get('BLINK_NETWORK'));
  const chosen = await askChoice(
    '  Networks to arm and disarm',
    available.map(_ => _.name),
    preselected,
  );

  env.set(ENV_KEYS.blinkNetworks, chosen.join(','));
  console.log(chalk.green(`  Selected: ${chosen.join(', ')}`));
}

/**
 * Sync notifications are opt in: an empty address means none are sent, which
 * is the way to switch them off without touching anything else.
 */
async function configureNotifications(env: Map<string, string>): Promise<void> {
  heading(5, 'Notifications');
  console.log(chalk.gray('  A summary email after every arm/disarm. Leave blank to switch off.'));

  const existing = env.get(ENV_KEYS.notifyEmail);
  const wanted = await confirm('  Send notification emails?', Boolean(existing));

  if (!wanted) {
    env.delete(ENV_KEYS.notifyEmail);
    console.log(chalk.green('  Notifications off'));
    return;
  }

  const address = await ask('  Send notifications to', existing || env.get(ENV_KEYS.gmailEmail));
  if (!address) {
    env.delete(ENV_KEYS.notifyEmail);
    console.log(chalk.green('  Notifications off'));
    return;
  }

  env.set(ENV_KEYS.notifyEmail, address);
  console.log(chalk.green(`  Notifications to ${address}`));
}

export async function runSetup(): Promise<void> {
  console.log(chalk.bold('\niot-sync-simplisafe-blink setup'));
  console.log(chalk.gray(`  Writing ${ENV_PATH}`));

  const env = readEnvFile(ENV_PATH);

  try {
    await configureGmail(env);
    const blink = await configureBlink(env);
    await configureNetworks(env, blink);
    await configureNotifications(env);

    heading(6, 'Saving');
    stripObsoleteKeys(env);
    writeEnvFile(ENV_PATH, env);
    console.log(chalk.green(`  Wrote ${ENV_PATH} (mode 600)`));
  } finally {
    closePrompts();
  }

  console.log(chalk.bold('\nSetup complete.'));
  console.log(`  Make sure SimpliSafe is set to send its notifications to ${env.get(ENV_KEYS.gmailEmail)}.`);
  console.log(`  Test it now:  ${chalk.cyan('bun run src/cli.ts arm')}`);
  console.log(`  Then run:     ${chalk.cyan('bun start')}\n`);
}
