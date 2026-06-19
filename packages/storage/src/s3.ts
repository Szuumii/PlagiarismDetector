import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@repo/config/env";

const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

const client = new S3Client({
  region: requireEnv("S3_REGION"),
  requestChecksumCalculation: "WHEN_REQUIRED",
  ...(accessKeyId && secretAccessKey
    ? { credentials: { accessKeyId, secretAccessKey } }
    : {}),
});
const bucket = requireEnv("S3_BUCKET");

export const PDF_CONTENT_TYPE = "application/pdf";

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!res.Body) throw new Error(`S3 object not found: ${key}`);
  return res.Body.transformToByteArray();
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export type PresignUploadInput = {
  key: string;
  expiresIn?: number;
};

export async function presignUploadUrl({
  key,
  expiresIn = 900,
}: PresignUploadInput): Promise<{ uploadUrl: string; objectKey: string }> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: PDF_CONTENT_TYPE,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  return { uploadUrl, objectKey: key };
}

export function libraryObjectKey(documentId: string): string {
  return `library/${documentId}.pdf`;
}

export function suspectObjectKey(orgId: string, suspectId: string): string {
  return `orgs/${orgId}/suspects/${suspectId}.pdf`;
}
