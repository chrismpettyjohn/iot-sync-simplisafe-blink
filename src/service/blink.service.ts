import { LoggerService } from './logger.service';
import { ask } from '../lib/prompt';
import { readBlinkAuth, writeBlinkAuth } from '../lib/blink-auth-store';
import type { ArmResult, ArmState, ArmTarget } from '../lib/arm-target';

interface BlinkAuthResponse {
  account: {
    account_id: string;
    user_id: string;
    client_id: string;
    client_verification_required: boolean;
    tier: string;
  };
  auth: {
    token: string;
  };
}

interface BlinkPinVerifyResponse {
  valid?: boolean;
  message?: string;
}

export interface BlinkNetwork {
  id: number;
  name: string;
  armed: boolean;
}

export interface BlinkCredentials {
  email: string;
  password: string;
  clientId: string;
  networks: string[];
}

const DEFAULT_BASE_URL = 'https://rest-prod.immedia-semi.com';

export class BlinkService implements ArmTarget {
  readonly name = 'blink';

  private readonly logger = new LoggerService('BlinkService');

  private baseUrl = DEFAULT_BASE_URL;
  private authToken = '';
  private networks: BlinkNetwork[] = [];

  constructor(private readonly credentials: BlinkCredentials) {}

  async login(): Promise<void> {
    this.logger.info('Logging in to Blink API');

    // A stored token means this client id has already cleared 2FA, so Blink
    // is asked to reauth rather than re-issuing a PIN challenge.
    const stored = readBlinkAuth(this.credentials.clientId);
    if (stored) this.logger.debug('Found stored Blink client verification');

    const response = await fetch(`${DEFAULT_BASE_URL}/api/v5/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.credentials.email,
        password: this.credentials.password,
        unique_id: this.credentials.clientId,
        reauth: Boolean(stored),
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      this.logger.error(message);
      throw new Error(`Login failed with status: ${response.status}`);
    }

    const data = (await response.json()) as BlinkAuthResponse;
    this.baseUrl = `https://rest-${data.account.tier}.immedia-semi.com`;
    this.authToken = data.auth.token;

    if (data.account.client_verification_required) {
      await this.verifyClientWithPin(data.account.account_id, data.account.client_id);
    }

    writeBlinkAuth({
      uniqueId: this.credentials.clientId,
      token: this.authToken,
      tier: data.account.tier,
      accountId: data.account.account_id,
      clientId: data.account.client_id,
      verifiedAt: new Date().toISOString(),
    });

    this.logger.info('Logged in to Blink API');
  }

  async verifyClientWithPin(accountId: string, clientId: string): Promise<void> {
    const pin = await ask('Enter the Blink verification PIN');

    const response = await fetch(
      `${this.baseUrl}/api/v4/account/${accountId}/client/${clientId}/pin/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', TOKEN_AUTH: this.authToken },
        body: JSON.stringify({ pin }),
      },
    );

    if (!response.ok) {
      const message = await response.text();
      this.logger.error(message);
      throw new Error(`PIN verification failed with status: ${response.status}`);
    }

    const data = (await response.json()) as BlinkPinVerifyResponse;
    if (!data.valid) throw new Error(data.message ?? 'PIN invalid or expired');

    this.logger.info('Client successfully verified');
  }

  /** Every network on the account, whether or not it is configured for sync. */
  async listNetworks(): Promise<BlinkNetwork[]> {
    if (!this.authToken) throw new Error('Not authenticated. Call login() first');

    const response = await fetch(`${this.baseUrl}/networks`, {
      headers: { TOKEN_AUTH: this.authToken },
    });

    if (!response.ok) {
      throw new Error(`Failed to get networks with status: ${response.status}`);
    }

    const data = (await response.json()) as { networks: BlinkNetwork[] };
    return data.networks ?? [];
  }

  /**
   * Resolves every configured network name to an id and caches the result.
   *
   * Unmatched names fail with the list of what does exist, since an exact name
   * mismatch is the most likely configuration error here.
   */
  async resolveNetworks(): Promise<void> {
    const available = await this.listNetworks();

    const resolved: BlinkNetwork[] = [];
    const missing: string[] = [];

    for (const wanted of this.credentials.networks) {
      const match = available.find(_ => _.name.trim().toLowerCase() === wanted.trim().toLowerCase());
      if (match) resolved.push(match);
      else missing.push(wanted);
    }

    if (missing.length > 0) {
      const names = available.map(_ => _.name).join(', ') || '(none)';
      throw new Error(`Network(s) not found on this Blink account: ${missing.join(', ')}. Available: ${names}`);
    }

    this.networks = resolved;
    this.logger.info(`Syncing ${resolved.length} network(s): ${resolved.map(_ => _.name).join(', ')}`);
  }

  async apply(state: ArmState): Promise<ArmResult[]> {
    return this.setArmed(state === 'armed');
  }

  /**
   * Arms or disarms every configured network.
   *
   * Requests are settled independently so one unreachable sync module cannot
   * leave the others in the wrong state; the caller reports the breakdown.
   */
  async setArmed(armed: boolean): Promise<ArmResult[]> {
    if (!this.authToken) throw new Error('Not authenticated. Call login() first');
    if (this.networks.length === 0) throw new Error('No networks. Call resolveNetworks() first');

    const action = armed ? 'arm' : 'disarm';
    this.logger.info(`${armed ? 'Arming' : 'Disarming'} ${this.networks.length} Blink network(s)`);

    const settled = await Promise.allSettled(
      this.networks.map(async network => {
        const response = await fetch(`${this.baseUrl}/network/${network.id}/${action}`, {
          method: 'POST',
          headers: { TOKEN_AUTH: this.authToken },
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(`status ${response.status}: ${message}`);
        }

        network.armed = armed;
      }),
    );

    const results: ArmResult[] = settled.map((outcome, index) => {
      const name = this.networks[index]!.name;
      if (outcome.status === 'fulfilled') {
        this.logger.info(`${action} succeeded for ${name}`);
        return { name, ok: true };
      }

      const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      this.logger.error(`${action} failed for ${name}: ${error}`);
      return { name, ok: false, error };
    });

    if (results.every(_ => !_.ok)) {
      throw new Error(`Failed to ${action} every network: ${results.map(_ => `${_.name} (${_.error})`).join('; ')}`);
    }

    return results;
  }
}
