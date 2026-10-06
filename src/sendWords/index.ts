import { readFileSync } from 'fs';
import { checkFile } from '../middlewares/checkAll.js';
import { cropFile } from '../middlewares/cropFile.js';
import { fileExists } from '../middlewares/fileExists.js';
import got from 'got';
import { isNotEqual } from '../middlewares/isEqual.js';

interface addWordResponce {
  body: number;
}

export async function sendFile(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path)) {
    const resOfCrop: Array<Array<string> | "\n"> = cropFile(path, serverWordPerRequest);
    if (!fileExists("./.ambi")) return console.error("🤨 Hey, you did not log in to server...");
    const token = readFileSync("./.ambi", { encoding: 'utf8', flag: 'r' }).trim();
    // This count used to be recomputed inside the per-word loop: a file of
    // n chunks walked the whole list once per word just to print progress.
    const total = resOfCrop.filter(x => x == '\n' || isNotEqual(x, [""])).length;
    // for..in over an array hands back string keys and inherited properties.
    for (const [id, arr] of resOfCrop.entries()) {
      try {
        if (arr != "\n" && isNotEqual(arr, [""])) {
          for (const word of arr) {
            const postRequest: addWordResponce = await got.post(`${process.env.url}/words`, {
              json: {
                "text": word
              },
              responseType: 'json',
              headers: {
                "Authorization": `Bearer ${token}`
              }
            });
            if (postRequest.body) {
              console.log(`⏳Loading... ${id + 1}/${total}`);
            }
          }
        }
      } catch {
        console.error(process.env.errorText);
      }
    }

  }
  else return;
}
