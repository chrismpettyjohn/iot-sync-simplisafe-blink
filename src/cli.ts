#!/usr/bin/env bun
import chalk from 'chalk';
import { loadConfig } from './config';
import { SimplisafeMonitor } from './monitor';
import { BlinkService } from './service/blink.service';
import { GmailService } from './service/gmail.service';
import { runSetup } from './setup';
import { closePrompts } from './lib/prompt';
import type { ArmState } from './lib/arm-target';

function usage(): void {
  console.log(`
${chalk.bold('iot-sync-simplisafe-blink')}

  ${chalk.cyan('bun run setup')}     Interactive first-run configuration
  ${chalk.cyan('bun start')}         Watch Gmail and sync SimpliSafe -> Blink
  ${chalk.cyan('bun run src/cli.ts arm')}      Arm every configured network now
  ${chalk.cyan('bun run src/cli.ts disarm')}   Disarm every configured network now
  ${chalk.cyan('bun run src/cli.ts help')}     Show this message
`);
}

/** Logs in to Blink and resolves the configured networks. */
async function connectBlink() {
  const config = loadConfig();
  const blink = new BlinkService(config.blink);
  await blink.login();
  await blink.resolveNetworks();
  return { config, blink };
}

async function runStart(): Promise<void> {
  const { config, blink } = await connectBlink();
  closePrompts();

  const gmail = new GmailService(config.gmail);
  await gmail.login();

  const monitor = new SimplisafeMonitor({
    gmail,
    targets: [blink],
    notifyEmail: config.notifyEmail,
  });

  const shutdown = async (signal: string) => {
    console.log(chalk.yellow(`\nReceived ${signal}, shutting down`));
    await gmail.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await monitor.start();
}

async function runArm(state: ArmState): Promise<void> {
  const { blink } = await connectBlink();
  closePrompts();

  const results = await blink.apply(state);

  for (const result of results) {
    console.log(result.ok
      ? chalk.green(`  ${result.name}: ${state}`)
      : chalk.red(`  ${result.name}: FAILED (${result.error})`));
  }

  if (results.some(_ => !_.ok)) process.exit(1);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';

  switch (command) {
    case 'start':
      await runStart();
      return;
    case 'setup':
      await runSetup();
      return;
    case 'arm':
      await runArm('armed');
      return;
    case 'disarm':
      await runArm('disarmed');
      return;
    case 'help':
    case '--help':
    case '-h':
      usage();
      return;
    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      usage();
      process.exit(1);
  }
}

main().catch(error => {
  closePrompts();
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
