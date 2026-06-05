import { getObject, putObject } from "./s3";

export class Storage {
  getObject(key: string): Promise<Uint8Array> {
    return getObject(key);
  }

  putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    return putObject(key, body, contentType);
  }
}
