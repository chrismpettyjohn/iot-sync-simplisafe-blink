import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { BLINK_CLIENT, BLINK_EMAIL, BLINK_NETWORK, BLINK_PASS, BLINK_VERIFIED } from '../config';
import { LoggerService } from './logger.service';

interface BlinkAuthResponse {
    account: {
        account_id: string;
        user_id: string;
        client_id: string;
        client_verification_required: boolean;
        tier: string;
    }
    auth: {
        token: string;
    }
}

interface BlinkNetwork {
  id: number;
  name: string;
  armed: boolean;
}

export class BlinkService {
  private readonly logger = new LoggerService(BlinkService);
  
  private baseUrl = 'https://rest-prod.immedia-semi.com';
  private authToken  = '';
  private network: BlinkNetwork | undefined;


  async login(): Promise<void> {
    this.logger.info('Logging in to Blink API');
    
    try {
      const response = await fetch(`${this.baseUrl}/api/v5/account/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: BLINK_EMAIL,
          password: BLINK_PASS,
          unique_id: BLINK_CLIENT,
          reauth: BLINK_VERIFIED
        }),
      });

      if (!response.ok) {
        const msg = await response.text();
        this.logger.error(msg)
        throw new Error(`Login failed with status: ${response.status}`);
      }

      const data: BlinkAuthResponse = await response.json();
      this.baseUrl = `https://rest-${data.account.tier}.immedia-semi.com`;
      this.authToken = data.auth.token;
      
      if (data.account.client_verification_required) {
        await this.verifyClientWithPin(data.account.account_id, data.account.client_id);
      }

      await this.getNetwork();
    } catch (error) {
      this.logger.error(`Login failed: ${error}`);
      throw error;
    }
  }

  async verifyClientWithPin(accountId: string, clientId: string): Promise<void> {  
    const rl = readline.createInterface({ input, output });
    const pin = await rl.question('Enter the Blink verification PIN: ');
    console.log(pin)
    rl.close();
  
    try {
      const response = await fetch(`${this.baseUrl}/api/v4/account/${accountId}/client/${clientId}/pin/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'TOKEN_AUTH': this.authToken,
        },
        body: JSON.stringify({ pin }),
      });
  
      if (!response.ok) {
        const msg = await response.text();
        this.logger.error(msg);
        throw new Error(`PIN verification failed with status: ${response.status}`);
      }
  
      const data = await response.json();
      if (!data.valid) throw new Error('PIN invalid or expired');
  
      this.logger.info('Client successfully verified');
    } catch (error) {
      this.logger.error(`PIN verification failed: ${error}`);
      throw error;
    }
  }
  
  private async getNetwork(): Promise<void> {
    if (!this.authToken) {
      throw new Error('Not authenticated. Call login() first');
    }

    try {
      const response = await fetch(`${this.baseUrl}/networks`, {
        headers: {
          'TOKEN_AUTH': this.authToken,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get networks with status: ${response.status}`);
      }

      const data: { networks: BlinkNetwork[] } = await response.json();

      const matchingNetwork: BlinkNetwork | undefined = data.networks.find(_ => _.name === BLINK_NETWORK);

      if (!matchingNetwork) {
        throw new Error(`${BLINK_NETWORK} is missing from networks`);
      }

      this.logger.info(`Found matching network ${BLINK_NETWORK}`);
      this.network = matchingNetwork;
    } catch (error) {
      this.logger.error(`Network list failed: ${error}`);
      throw error;
    }
  }

  async armSystem(): Promise<boolean> {
    try {
        this.logger.info('Arming Blink system');
        
        if (!this.authToken) throw new Error('Not authenticated. Call login() first');

        if (!this.network) throw new Error('No network. Call getNetwork() first');
      
        const response = await fetch(`${this.baseUrl}/network/${this.network.id}/arm`, {
          method: 'POST',
          headers: {
              'TOKEN_AUTH': this.authToken,
          },
        });
        
        if (!response.ok) {
          const message = await response.text();
          throw new Error(`Failed to arm network ${BLINK_NETWORK} with status: ${response.status} and message: ${message}`);
        }

      this.logger.info('Arm success');
      return true;
    } catch (error) {
      this.logger.error(`Arm failure: ${error}`);
      throw error;
    }
  }

  async disarmSystem(): Promise<void> {
    try {
        this.logger.info('Disarming Blink system');
        
        if (!this.authToken) throw new Error('Not authenticated. Call login() first');

        if (!this.network) throw new Error('No network. Call getNetwork() first');
      
        const response = await fetch(`${this.baseUrl}/network/${this.network.id}/disarm`, {
          method: 'POST',
          headers: {
            'TOKEN_AUTH': this.authToken,
          },
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(`Failed to disarm network ${BLINK_NETWORK} with status: ${response.status} and message: ${message}`);
        }

      this.logger.info('Disarm success');
    } catch (error) {
      this.logger.error(`Disarm failed: ${error}`);
      throw error;
    }
  }
}

export const blinkService: BlinkService = new BlinkService();