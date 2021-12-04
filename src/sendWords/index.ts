import { checkFile } from '../middlewares/checkAll';
import { cropFile } from '../middlewares/cropFile';

export async function sendFile(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path))
    for (const arr of cropFile(path, serverWordPerRequest))
      console.log(JSON.stringify(arr));
  else return;
}