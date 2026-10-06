import { basename as bpath } from 'path';
import { list as textEx } from './exList.js';

// A Set, rather than an indexOf scan over the 300-odd entries of exList on
// every call.
const textExSet = new Set(textEx);

export const isText = (
  filename: string
): boolean => textExSet.has(bpath(filename).split('.').reverse()[0]);
