import { Command } from 'commander';
import { tryToLogIn } from './login';

const program = new Command();
program.version(process.env.version || "¯\\_(ツ)_/¯");
program.option('-l --login', 'Login to AmbiglyphID').action(tryToLogIn);
program.parse(process.argv);