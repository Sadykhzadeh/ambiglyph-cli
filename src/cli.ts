import { readFileSync } from 'fs';
import { Command } from 'commander';

// Every command imports what it needs when it runs. got alone takes ~65 ms to
// load, and --help, --version and a typo should not pay for it.

// Only the server commands read configuration, so the .env file is parsed
// there and nowhere else. A missing file is fine, as it was with dotenv.
const loadEnv = (): void => {
  try { process.loadEnvFile(); } catch { /* no .env */ }
};
const wordsPerRequest = (): number => +(process.env.serverWordPerRequest || 4);

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const program = new Command();
program.name('ambiglyph');
program.version(version);

program.command('login').description('Login to Ambiglyph Server').action(async () => {
  loadEnv();
  const { tryToLogIn } = await import('./login/index.js');
  await tryToLogIn();
});
program.command('logout').description('Logout to Ambiglyph Server').action(async () => {
  const { tryToLogOut } = await import('./logout/index.js');
  await tryToLogOut();
});
program.command('add <usPath>').description('Add all words of your file to cloud storage').action(async (usPath) => {
  loadEnv();
  const { sendFile } = await import('./sendWords/index.js');
  await sendFile(usPath, wordsPerRequest());
});
program.command('check <usPath>').description('Check your file via your cloud storage words or via our database').action(async (usPath) => {
  loadEnv();
  const { checkContent } = await import('./checkContent/index.js');
  await checkContent(usPath, wordsPerRequest());
});
await program.parseAsync(process.argv);
