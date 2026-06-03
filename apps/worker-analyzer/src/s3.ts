// TODO: promote to a shared @repo/storage package when a third caller appears.
// Currently duplicated with apps/worker-indexer/src/s3.ts.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "@repo/config/env";

const region = requireEnv("S3_REGION");
const bucket = requireEnv("S3_BUCKET");

export const s3 = new S3Client({ region });

export async function getObjectBody(key: string): Promise<Uint8Array> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) {
    throw new Error(`S3 GetObject returned no body for key: ${key}`);
  }
  return await response.Body.transformToByteArray();
}
