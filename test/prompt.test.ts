import { describe, expect, test, afterEach } from 'bun:test';
import { spawn } from 'bun';

const CLI = new URL('../src/cli.ts', import.meta.url).pathname;
const HELPER = new URL('./fixtures/choice.ts', import.meta.url).pathname;

/** Drives a script with piped stdin, as a non-interactive run would. */
async function run(script: string, input: string, args: string[] = []) {
  const proc = spawn(['bun', 'run', script, ...args], {
    stdin: new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, LOG_LEVEL: 'silent', NO_COLOR: '1' },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe('askChoice', () => {
  test('selects by number', async () => {
    const { stdout } = await run(HELPER, '1,3\n');
    expect(stdout).toContain('picked: Indoors,Garage');
  });

  test('"all" selects everything', async () => {
    const { stdout } = await run(HELPER, 'all\n');
    expect(stdout).toContain('picked: Indoors,Outdoors,Garage');
  });

  test('an empty answer keeps the preselection', async () => {
    const { stdout } = await run(HELPER, '\n');
    expect(stdout).toContain('picked: Outdoors');
  });

  test('accepts names as well as numbers', async () => {
    const { stdout } = await run(HELPER, 'garage,indoors\n');
    expect(stdout).toContain('picked: Garage,Indoors');
  });

  test('re-asks after an out-of-range answer', async () => {
    const { stdout } = await run(HELPER, '9\n2\n');
    expect(stdout).toContain('Please choose from the numbers listed above');
    expect(stdout).toContain('picked: Outdoors');
  });

  test('duplicates collapse', async () => {
    const { stdout } = await run(HELPER, '2,2\n');
    expect(stdout).toContain('picked: Outdoors');
  });
});

describe('cli', () => {
  test('help lists the commands', async () => {
    const { stdout, exitCode } = await run(CLI, '', ['help']);
    expect(stdout).toContain('bun run setup');
    expect(stdout).toContain('arm');
    expect(exitCode).toBe(0);
  });

  test('an unknown command exits non-zero', async () => {
    const { stderr, exitCode } = await run(CLI, '', ['bogus']);
    expect(stderr).toContain('Unknown command: bogus');
    expect(exitCode).toBe(1);
  });

  test('start without configuration points at setup', async () => {
    const proc = spawn(['bun', 'run', CLI, 'start'], {
      stdin: new TextEncoder().encode(''),
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: '/tmp',
      env: {
        PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
        LOG_LEVEL: 'silent', NO_COLOR: '1',
      },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(stderr).toContain('Missing configuration');
    expect(stderr).toContain('bun run setup');
  });
});
