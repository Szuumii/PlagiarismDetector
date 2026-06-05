import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "@repo/config/env";

const client = new S3Client({ region: requireEnv("S3_REGION") });
const bucket = requireEnv("S3_BUCKET");

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`S3 object not found: ${key}`);
  return res.Body.transformToByteArray();
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}
