import prompts from 'prompts';
import { unlinkSync } from 'fs';

export async function tryToLogOut(): Promise<void> {
  try {
    if ((await prompts({
      name: 'userAns',
      message: `🤔 Are you sure to log out?`,
      type: 'toggle',
      initial: false,
      active: 'Yes',
      inactive: 'No'
    })).userAns) unlinkSync('./.ambi');
  } catch (error) {
    return;
  }
}