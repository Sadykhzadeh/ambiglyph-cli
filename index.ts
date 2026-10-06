#!/usr/bin/env node
// `dotenv/config` instead of calling config() in the body: under ESM every
// import is evaluated before the first statement of this file runs, so
// ./src/cli would have started up against an empty process.env.
import 'dotenv/config';
import './src/cli.js';
