import got from 'got';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { checkFile } from '../middlewares/checkAll';
import { cropFile } from '../middlewares/cropFile';
import { fileExists } from '../middlewares/fileExists';
import { isNotEqual } from '../middlewares/isEqual';

interface ServerAnswer {
  body: {
    text: string;
    haveDetections: boolean;
    candidates: Array<string>;
    haveWarnings: boolean;
    warnings: Array<string>;
  }
}

export async function checkContent(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path)) {
    const resOfCrop: Array<Array<string> | "\n"> = cropFile(path, serverWordPerRequest);
    for (const arr of resOfCrop) {
      try {
        if (!fileExists("./.ambi")) return console.error("🤨 Hey, you did not log in to server...");
        let mainResult = "";
        if (arr != "\n" && isNotEqual(arr, [""])) {
          const postRequest: ServerAnswer = await got.post(`${process.env.url}/check`, {
            json: {
              "text": arr.join(" "),
              "suggestionsNumber": 100,
              "warningsNumber": 100
            },
            responseType: 'json',
            headers: {
              "Authorization": `Bearer ${readFileSync("./.ambi", { encoding: 'utf8', flag: 'r' })}`
            }
          });
          const postResponce = postRequest.body;
          mainResult += postResponce.text;
        } else if (arr == "\n") mainResult += arr;
        unlinkSync(`${path}.remove`);
        writeFileSync(`${path}.remove`, mainResult);
      } catch (e) { console.error(e); }
    }
  }
  else return;
}