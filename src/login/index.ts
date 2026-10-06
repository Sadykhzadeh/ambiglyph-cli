import prompts from 'prompts';
import got, { HTTPError } from 'got';
import { chmodSync, writeFileSync } from 'fs';

interface AuthAnswer {
  body: {
    token: string;
  }
}

async function authenticationToServer(username: string, password: string): Promise<void> {
  try {
    console.log("⏳Loading...");
    const authRequest: AuthAnswer = await got.post(`${process.env.url}/authenticate`, {
      json: {
        "login": username,
        "password": password
      },
      responseType: 'json',
    }), authResponce = authRequest.body;
    // The token is a credential, so it must not be world-readable the way
    // the default 0644 left it.
    writeFileSync('./.ambi', authResponce.token, { mode: 0o600 });
    chmodSync('./.ambi', 0o600);
    console.log(`✅ Done! Welcome, ${username}!\n(Don't forget to logout after you done. Command: ambiglyph logout)`);
  } catch (e) {
    // `if (got.HTTPError)` tested a class for truthiness, so it was always
    // taken - a timeout or a DNS failure was reported as a bad password.
    if (e instanceof HTTPError) {
      console.log("🥲 I guess you typed wrong username/password. Try again.");
    } else console.error(process.env.errorText);
  }
}

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
      validate: (vl) => {
        if (vl === usernameResponce.vl) return `Please, do not use your username as a password 😄`;
        if (vl.length < 8) return 'Too short password. Length should be at least 8 symbols 👀';
        if (vl.length >= 100) return 'Strong password are great, but not more than 100 symbols, please 🙃';
        return true;
      }
    });
    await authenticationToServer(usernameResponce.vl, passwordResponce.vl);
  } catch { console.error(process.env.errorText); }
}