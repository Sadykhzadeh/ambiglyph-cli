import { accessSync, constants } from 'fs';

export const fileExists = (path: string): boolean => {
  try { accessSync(path, constants.F_OK); }
  catch { return false; }
  return true;
};