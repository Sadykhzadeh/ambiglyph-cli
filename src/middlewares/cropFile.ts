import { readFileSync } from 'fs';

function cropPar(par: string, limit: number): Array<Array<string>> {
  if (!par) return [[""]];
  const returnArr = [];
  while (par.split(" ").length > limit) {
    const stringResp = par.split(" ", limit);
    returnArr.push(stringResp);
    par = par.slice(stringResp.join(" ").length + 1);
  }
  if (par.split(" ").length > 0) returnArr.push(par.split(" "));
  return returnArr;
}

export function cropFile(path: string, limit: number): Array<Array<string>> {
  const data = readFileSync(path, { encoding: 'utf8', flag: 'r' });
  const paragraphArr = data.split("\n");
  let resultOfCropFile: Array<Array<string>> = [];
  for (const parEl of paragraphArr) {
    const cropParResult = cropPar(parEl, limit);
    resultOfCropFile = resultOfCropFile.concat(cropParResult);
  }
  return resultOfCropFile;
}