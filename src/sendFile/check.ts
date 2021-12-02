import { accessSync, constants } from 'fs';
import { isText } from '../checkFile/isText';
import prompts from 'prompts';

const fileExists = (path: string): boolean => {
  let doesFileExist = true;
  try {
    accessSync(path, constants.F_OK);
  } catch (e) {
    doesFileExist = false;
  }
  return doesFileExist;
};

export async function checkFile(path: string): Promise<boolean> {
  if (fileExists(path)) {
    if (isText(path)) {
      return true;
    } else {
      console.error('I guess this file is not a text file.');
      return (await prompts({
        name: 'userAns',
        message: `Are you sure that ${path} is a text file?`,
        type: 'toggle',
        initial: false,
        active: 'Yes',
        inactive: 'No'
      })).userAns;
    }
  } else {
    console.error('Could not find a file. Please, check a path of file.');
    return false;
  }
}