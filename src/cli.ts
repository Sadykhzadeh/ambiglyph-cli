import { Command } from 'commander';
import { tryToLogIn } from './login';
import { sendFile } from './sendFile';

const program = new Command();
program.version(process.env.version || "¯\\_(ツ)_/¯");
program.command('login').description('Login to AmbiglyphID').action(tryToLogIn);
program.command('add <usPath>').description('Add all words of your file to cloud storage').action((usPath) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  sendFile(usPath, +(process.env.serverWordPerRequest) || 4);
});
program.parse(process.argv);