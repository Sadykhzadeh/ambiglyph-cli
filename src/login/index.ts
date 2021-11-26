// in future, there'll be a code of login command
import md5 from 'md5';
import prompts from 'prompts';

export async function tryToLogIn(): Promise<void> {
  try {
    const usernameResponce = await prompts({
      type: 'text',
      name: 'vl',
      message: 'Enter your username: '
    }), passwordResponce = await prompts({
      type: 'password',
      name: 'vl',
      message: 'Enter your password: ',
      validate: vl => vl === usernameResponce.vl ? `Please, do not use your username as a password` : true
    });
    console.table([md5(usernameResponce.vl), md5(passwordResponce.vl)]);
  } catch (err) {
    console.error('Oops...', err);
  }
}