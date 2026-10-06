import got from 'got';
import fs from 'fs';
import { checkFile } from '../middlewares/checkAll.js';
import { cropFile } from '../middlewares/cropFile.js';
import { fileExists } from '../middlewares/fileExists.js';
import { isNotEqual } from '../middlewares/isEqual.js';
import prompts from 'prompts';

interface ServerAnswer {
  body: {
    text: string;
    haveDetections: boolean;
    candidates: Array<Array<string>>;
  }
}

const diff2Strings = (stringOne: string, stringTwo: string): Array<string> => {
  const arrayAns: Array<string> = [];
  const arrayOne = stringOne.split(" "), arrayTwo = stringTwo.split(" ");
  for (let i = 0; i < arrayOne.length; ++i) {
    if (arrayOne[i] != arrayTwo[i]) arrayAns.push(arrayOne[i]);
  }
  return arrayAns;
};

export async function checkContent(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path)) {
    const resOfCrop: Array<Array<string> | "\n"> = cropFile(path, serverWordPerRequest);
    if (!fileExists("./.ambi")) return console.error("🤨 Hey, you did not log in to server...");
    // createWriteStream truncates an existing file, so the unlink-then-write
    // that used to precede it was doing nothing.
    const outputPath = `${process.cwd()}/${path}.remove`;
    const streamData = fs.createWriteStream(outputPath);
    const token = fs.readFileSync("./.ambi", "utf8").trim();
    console.log("⏳Loading...");
    for (const arr of resOfCrop) {
      try {
        if (arr != "\n" && isNotEqual(arr, [""])) {
          const postRequest: ServerAnswer = await got.post(`${process.env.url}/check`, {
            json: {
              "text": arr.join(" "),
              "suggestionsNumber": 100,
              "warningsNumber": 100
            },
            responseType: 'json',
            headers: {
              "Authorization": `Bearer ${token}`
            }
          });
          const postResponce = postRequest.body;
          let futureText = postResponce.text;
          if (postResponce.candidates.length) {
            console.log(`❗️ We found ${postResponce.candidates.length} issue(s), that may be related with omoglyphs.`);
            const diffCheck: Array<string> = diff2Strings(arr.join(" "), futureText);
            for (let i = 0; i < diffCheck.length; i++) {
              const choiseArr: Array<{ title: string, value: string }> = [];
              // A detection carrying no candidates used to throw here, on
              // choiseArr[0].value further down.
              for (const cand of postResponce.candidates[i] ?? []) {
                choiseArr.push({ title: cand, value: cand });
              }
              if (!choiseArr.length) continue;
              const askForReplace = await prompts({
                type: 'select',
                name: 'value',
                message: `To what we should replace "${diffCheck[i]}" word?`,
                choices: choiseArr,
                initial: 0
              });
              futureText = futureText.replace(`<%ambiglyph-detected>${i}<ambiglyph-detected%>`, askForReplace.value || choiseArr[0].value);
            }
          }
          streamData.write(futureText);
        } else if (arr == "\n") streamData.write("\n");
      } catch { console.error(process.env.errorText); }
    }
    // close() returns immediately, so the old code could announce the file
    // before the queued writes had actually reached it.
    await new Promise<void>((resolve, reject) => {
      streamData.once('error', reject);
      streamData.end(resolve);
    });
    console.log(`✅ Done! Check file ${path}.remove\nIf it's okay, remove the ".remove" part from file name!`);
  }
  else return;
}