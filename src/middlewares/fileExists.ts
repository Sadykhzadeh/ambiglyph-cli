import { accessSync, constants } from 'fs';

export const fileExists = (path: string): boolean => {
  let doesFileExist = true;
  try {
    accessSync(path, constants.F_OK);
  } catch (e) {
    doesFileExist = false;
  }
  return doesFileExist;
};