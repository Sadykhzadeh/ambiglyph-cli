import { readFileSync } from 'fs';
import { Command } from 'commander';

// Every command imports what it needs when it runs. got alone takes ~65 ms to
// load, and --help, --version and a typo should not pay for it.

// Only the server commands read configuration, so the .env file is parsed
// there and nowhere else. A missing file is fine, as it was with dotenv; a
// missing server URL is not, since every request would go to "undefined".
const serverConfigured = (): boolean => {
  try { process.loadEnvFile(); } catch { /* no .env */ }
  if (process.env.url) return true;
  console.error('ambiglyph: set `url` to your Ambiglyph server, in the environment or a .env file (see .sample.env)');
  process.exitCode = 2;
  return false;
};
const wordsPerRequest = (): number => +(process.env.serverWordPerRequest || 4);

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const program = new Command();
program.name('ambiglyph');
program.version(version);
// A usage error exits with 2, so that 1 keeps meaning "problems found".
program.exitOverride(e => process.exit(e.exitCode === 0 ? 0 : 2));

program.command('check [paths...]')
  .description('find homoglyphs, mixed scripts and invisible characters, offline')
  .option('--json', 'print the findings as JSON')
  .option('--fix', 'rewrite the files with every suggested fix applied')
  .option('--server', 'check one file against an Ambiglyph server instead (needs `login`)')
  .addHelpText('after', `
Paths can be files, directories (walked, skipping node_modules and .git) or
globs; - reads stdin. The default is the current directory. With --fix, a
lone - turns the command into a filter: fixed text out, report on stderr.

Exit status: 0 nothing found (or all of it fixed), 1 problems found, 2 the
check could not run.`)
  .action(async (paths: string[], options: { json?: boolean, fix?: boolean, server?: boolean }) => {
    if (options.fix && paths.includes('-') && paths.length > 1) program.error('--fix reads - only on its own');
    if (options.server) {
      if (paths.length !== 1 || options.json || options.fix) program.error('--server checks exactly one file, without --json or --fix');
      if (!serverConfigured()) return;
      const { checkContent } = await import('./checkContent/index.js');
      await checkContent(paths[0], wordsPerRequest());
      return;
    }
    const { scan } = await import('./scan/index.js');
    process.exitCode = await scan(paths.length ? paths : ['.'], options);
  });

program.command('login').description('log in to an Ambiglyph server').action(async () => {
  if (!serverConfigured()) return;
  const { tryToLogIn } = await import('./login/index.js');
  await tryToLogIn();
});
program.command('logout').description('forget the server token').action(async () => {
  const { tryToLogOut } = await import('./logout/index.js');
  await tryToLogOut();
});
program.command('add <usPath>').description('add every word of a file to your word list on the server').action(async (usPath) => {
  if (!serverConfigured()) return;
  const { sendFile } = await import('./sendWords/index.js');
  await sendFile(usPath, wordsPerRequest());
});
await program.parseAsync(process.argv);
