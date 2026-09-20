import { config as loadDotenv } from 'dotenv';

export interface AppConfig {
  gmail: {
    email: string;
    appPassword: string;
  };
  blink: {
    email: string;
    password: string;
    clientId: string;
    networks: string[];
  };
  /** Where sync summaries go, or undefined to send none. */
  notifyEmail?: string;
}

export const ENV_KEYS = {
  gmailEmail: 'GMAIL_EMAIL',
  gmailPass: 'GMAIL_PASS',
  blinkEmail: 'BLINK_EMAIL',
  blinkPass: 'BLINK_PASS',
  blinkClient: 'BLINK_CLIENT',
  blinkNetworks: 'BLINK_NETWORKS',
  notifyEmail: 'NOTIFY_EMAIL',
} as const;

/** Splits a comma separated network list, trimming blanks. */
export function parseNetworks(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(_ => _.trim()).filter(_ => _.length > 0);
}

/**
 * Reads .env into process.env and builds the config.
 *
 * Every missing key is reported at once so a half configured install is fixed
 * in one pass rather than one restart per variable.
 */
export function loadConfig(): AppConfig {
  loadDotenv({ quiet: true });

  const missing: string[] = [];
  const read = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
      missing.push(key);
      return '';
    }
    return value;
  };

  const gmailEmail = read(ENV_KEYS.gmailEmail);
  const gmailPass = read(ENV_KEYS.gmailPass);
  const blinkEmail = read(ENV_KEYS.blinkEmail);
  const blinkPass = read(ENV_KEYS.blinkPass);
  const blinkClient = read(ENV_KEYS.blinkClient);

  // BLINK_NETWORK (singular) was the pre multi-network key; still honoured.
  const networks = parseNetworks(
    process.env[ENV_KEYS.blinkNetworks] ?? process.env.BLINK_NETWORK,
  );
  if (networks.length === 0) missing.push(ENV_KEYS.blinkNetworks);

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration: ${missing.join(', ')}.\nRun \`bun run setup\` to configure.`,
    );
  }

  // Optional on purpose: leaving NOTIFY_EMAIL unset turns the sync
  // notification emails off without affecting the inbox being watched.
  const notifyEmail = process.env[ENV_KEYS.notifyEmail]?.trim() || undefined;

  return {
    gmail: { email: gmailEmail, appPassword: gmailPass },
    blink: { email: blinkEmail, password: blinkPass, clientId: blinkClient, networks },
    notifyEmail,
  };
}
