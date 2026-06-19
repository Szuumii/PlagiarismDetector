import {
  getObject,
  libraryObjectKey,
  PDF_CONTENT_TYPE,
  presignUploadUrl,
  putObject,
  suspectObjectKey,
  type PresignUploadInput,
} from "./s3";

export class Storage {
  readonly pdfContentType = PDF_CONTENT_TYPE;

  getObject(key: string): Promise<Uint8Array> {
    return getObject(key);
  }

  putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    return putObject(key, body, contentType);
  }

  presignUploadUrl(
    input: PresignUploadInput,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return presignUploadUrl(input);
  }

  libraryObjectKey(documentId: string): string {
    return libraryObjectKey(documentId);
  }

  suspectObjectKey(orgId: string, suspectId: string): string {
    return suspectObjectKey(orgId, suspectId);
  }
}
