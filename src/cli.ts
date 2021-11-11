import { program } from 'commander';
// import chalk from 'chalk';
// import got from 'got';

program.version(process.env.VERSION_NUMBER || "¯\\_(ツ)_/¯");

let testFunc = (arg: string) => {
  return console.table(arg);
}

program.command('echo').option('-t --text <arg>', 'echo the argument').action(testFunc);

program.parse(process.argv);
const options = program.opts();

if (options?.test) {
  console.log(options?.test.echo);
}