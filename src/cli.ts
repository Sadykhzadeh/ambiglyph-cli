import { Command } from 'commander';
import { checkContent } from './checkContent';
import { tryToLogIn } from './login';
import { tryToLogOut } from './logout';
import { sendFile } from './sendWords';

const program = new Command();
program.version(process.env.version || "¯\\_(ツ)_/¯");

program.command('login').description('Login to Ambiglyph Server').action(tryToLogIn);
program.command('logout').description('Logout to Ambiglyph Server').action(tryToLogOut);
program.command('add <usPath>').description('Add all words of your file to cloud storage').action((usPath) =>
  sendFile(usPath, +(process.env.serverWordPerRequest || 4))
);
program.command('check <usPath>').description('Check your file via your cloud storage words or via our database').action(usPath =>
  checkContent(usPath, +(process.env.serverWordPerRequest || 4))
);
program.parse(process.argv);