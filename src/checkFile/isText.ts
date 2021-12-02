import { basename as bpath } from 'path';
import { list as textEx } from './textEx';

export const isText = (
  filename: string
): boolean => (textEx.indexOf(bpath(filename).split('.').reverse()[0]) !== -1);