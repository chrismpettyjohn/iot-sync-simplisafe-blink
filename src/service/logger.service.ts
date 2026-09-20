import chalk from 'chalk';

// Ordered by increasing severity; 'silent' sits above every real level so
// setting it suppresses all output.
const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type Level = (typeof LEVELS)[number];
type WritableLevel = Exclude<Level, 'silent'>;

function activeLevel(): Level {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  return LEVELS.includes(configured as Level) ? (configured as Level) : 'info';
}

export class LoggerService {
  constructor(private readonly name: string) {}

  private write(level: WritableLevel, colour: (text: string) => string, body: string) {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(activeLevel())) return;

    const line = `${new Date().toISOString()} ${this.name}: ${body}`;
    if (level === 'error') console.error(colour(line));
    else console.log(colour(line));
  }

  debug(body: string) { this.write('debug', chalk.gray, body); }
  info(body: string) { this.write('info', chalk.green, body); }
  warn(body: string) { this.write('warn', chalk.yellow, body); }
  error(body: string) { this.write('error', chalk.red, body); }
}
