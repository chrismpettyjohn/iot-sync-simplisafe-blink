import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * One interface is shared by every prompt.
 *
 * Creating and closing a fresh readline per question ends the underlying
 * stdin stream, so with piped input the second prompt would see EOF and never
 * resolve.
 */
let shared: readline.Interface | null = null;
let closed = false;

/** Lines already read but not yet consumed by a prompt. */
const buffered: string[] = [];
/** Prompts waiting for a line that has not arrived yet. */
const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];

function getInterface(): readline.Interface {
  if (shared) return shared;

  shared = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  closed = false;

  shared.on('line', line => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(line);
    else buffered.push(line);
  });

  // Piped stdin reaches EOF as soon as it is drained, which closes the
  // interface long before the last prompt runs. Buffering the lines keeps the
  // remaining answers available after that.
  shared.on('close', () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()!.reject(new Error('Input stream closed'));
  });

  return shared;
}

export function closePrompts(): void {
  shared?.close();
  shared = null;
  buffered.length = 0;
}

function nextLine(): Promise<string> {
  const queued = buffered.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  if (closed) return Promise.reject(new Error('Input stream closed'));
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

async function question(prompt: string, mask = false): Promise<string> {
  const iface = getInterface();

  // On a TTY the prompt goes through readline rather than straight to stdout,
  // so readline knows the cursor position and line editing stays correct.
  if (input.isTTY) {
    iface.setPrompt(prompt);
    iface.prompt();
  } else {
    output.write(prompt);
  }

  // readline echoes keystrokes through _writeToOutput; silencing it while the
  // answer is typed masks it without hiding the prompt.
  const internals = iface as unknown as { _writeToOutput?: (text: string) => void };
  const originalWrite = internals._writeToOutput;
  const masking = mask && Boolean(input.isTTY) && Boolean(originalWrite);
  if (masking) internals._writeToOutput = () => {};

  try {
    return (await nextLine()).trim();
  } finally {
    if (masking && originalWrite) {
      internals._writeToOutput = originalWrite;
      output.write('\n');
    }
  }
}

export async function ask(prompt: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await question(`${prompt}${suffix}: `);
  return answer || defaultValue || '';
}

export function askSecret(prompt: string, hasExisting = false): Promise<string> {
  const suffix = hasExisting ? ' [unchanged]' : '';
  return question(`${prompt}${suffix}: `, true);
}

export async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const answer = await ask(`${prompt} (y/n)`, defaultYes ? 'y' : 'n');
  return answer.toLowerCase().startsWith('y');
}

/**
 * Numeric multi-select. Accepts "1,3" or "all"; empty input keeps `preselected`.
 */
export async function askChoice(
  prompt: string,
  items: string[],
  preselected: string[] = [],
): Promise<string[]> {
  items.forEach((item, index) => {
    const marker = preselected.some(_ => _.toLowerCase() === item.toLowerCase()) ? '*' : ' ';
    output.write(`  ${marker} ${index + 1}) ${item}\n`);
  });

  while (true) {
    const fallback = preselected.length > 0 ? preselected.join(',') : 'all';
    const answer = await ask(`${prompt} (numbers separated by commas, or "all")`, fallback);

    if (answer.toLowerCase() === 'all') return [...items];

    // The default echoes back names rather than indexes, so accept both.
    const parts = answer.split(',').map(_ => _.trim()).filter(Boolean);
    const byName = parts
      .map(name => items.find(item => item.toLowerCase() === name.toLowerCase()))
      .filter((item): item is string => item !== undefined);
    if (byName.length === parts.length && byName.length > 0) return byName;

    const indexes = parts.map(Number);
    const valid = indexes.length > 0
      && indexes.every(index => Number.isInteger(index) && index >= 1 && index <= items.length);
    if (valid) return [...new Set(indexes)].map(index => items[index - 1]!);

    output.write('  Please choose from the numbers listed above.\n');
  }
}
