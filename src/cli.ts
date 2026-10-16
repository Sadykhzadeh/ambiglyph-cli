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
  .option('--sarif', 'print the findings as a SARIF log, for code scanning')
  .option('--fix', 'rewrite the files with every suggested fix applied')
  .option('--staged', 'check the files staged in git, as they will be committed (for a pre-commit hook)')
  .option('--ignore <glob>', 'skip the files matching this glob (repeatable)', (glob: string, globs: string[] = []) => [...globs, glob])
  .option('--server', 'check one file against an Ambiglyph server instead (needs `login`)')
  .addHelpText('after', `
With --staged, the files in git's index are checked instead, as they will be
committed; with nothing staged, nothing is checked.

Paths can be files, directories (walked, skipping node_modules, .git and what
git ignores) or globs; - reads stdin. The default is the current directory.
With --fix, a lone - turns the command into a filter: fixed text out, report
on stderr.

Exit status: 0 nothing found (or all of it fixed), 1 problems found, 2 the
check could not run.

A finding is dropped when its line says ambiglyph-ignore, or when the line
before it says ambiglyph-ignore-next-line, in a comment of any kind.`)
  .action(async (paths: string[], options: { json?: boolean, sarif?: boolean, fix?: boolean, staged?: boolean, ignore?: string[], server?: boolean }) => {
    if (options.fix && paths.includes('-') && paths.length > 1) program.error('--fix reads - only on its own');
    if (options.json && options.sarif) program.error('--json and --sarif are two formats; pick one');
    if (options.staged && (paths.length || options.fix || options.server)) program.error('--staged checks the staged files on its own, without paths, --fix or --server');
    if (options.server) {
      if (paths.length !== 1 || options.json || options.sarif || options.fix || options.ignore) program.error('--server checks exactly one file, without --json, --sarif, --fix or --ignore');
      if (!serverConfigured()) return;
      const { checkContent } = await import('./checkContent/index.js');
      await checkContent(paths[0], wordsPerRequest());
      return;
    }
    const { scan } = await import('./scan/index.js');
    process.exitCode = await scan(paths.length || options.staged ? paths : ['.'], options);
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
