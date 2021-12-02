import { checkFile } from './check';
import { cropFile } from './cropFile';

export async function sendFile(path: string, serverWordPerRequest: number): Promise<void> {
  if (await checkFile(path)) {
    const cf = cropFile(path, serverWordPerRequest);
    for (const sendArr of cf) {
      console.log(JSON.stringify(sendArr)); // here should be sending the JSON to server
    }
  } else return;
}