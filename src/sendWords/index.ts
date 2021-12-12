import { readFileSync } from 'fs';
import { checkFile } from '../middlewares/checkAll';
import { cropFile } from '../middlewares/cropFile';
import { fileExists } from '../middlewares/fileExists';
import got from 'got';
import { isNotEqual } from '../middlewares/isEqual';

interface addWordResponce {
  body: number;
}

export async function sendFile(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path)) {
    const resOfCrop: Array<Array<string> | "\n"> = cropFile(path, serverWordPerRequest);
    for (const id in resOfCrop) {
      try {
        const arr = resOfCrop[id];
        if (!fileExists("./.ambi")) return console.error("🤨 Hey, you did not log in to server...");
        if (arr != "\n" && isNotEqual(arr, [""])) {
          for (const word of arr) {
            const postRequest: addWordResponce = await got.post(`${process.env.url}/words`, {
              json: {
                "text": word
              },
              responseType: 'json',
              headers: {
                "Authorization": `Bearer ${readFileSync("./.ambi", { encoding: 'utf8', flag: 'r' })}`
              }
            });
            if (postRequest.body) {
              console.log(`⏳Loading... ${+id + 1}/${resOfCrop.filter(x => x == '\n' || isNotEqual(x, [""])).length}`);
            }
          }
        }
      } catch (e) {
        console.error("😔 Oops, we found some issues from our side. Please, check your Internet connection or try again later.");
      }
    }

  }
  else return;
}
