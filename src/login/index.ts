import prompts from 'prompts';
import got from 'got';
import { writeFileSync } from 'fs';

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
        "username": username,
        "password": password
      },
      responseType: 'json',
    }), authResponce = authRequest.body;
    writeFileSync('./.ambi', authResponce.token);
    console.log(`✅ Done! Welcome, ${username}!\n(Don't forget to logout after you done. Command: ambiglyph logout)`);
  } catch (e) {
    if (got.HTTPError) {
      console.log("🥲 I guess you typed wrong username/password. Try again.");
    } else console.error("😔 Oops, we found some issues from our side. Please, check your Internet connection or try again later.");
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
    authenticationToServer(usernameResponce.vl, passwordResponce.vl);
  } catch (err) { console.error("😔 Oops, we found some issues from our side. Please, check your Internet connection or try again later."); }
}