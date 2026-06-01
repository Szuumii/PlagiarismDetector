import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@repo/config/env";

const region = requireEnv("S3_REGION");
const bucket = requireEnv("S3_BUCKET");

export const s3 = new S3Client({ region });

export const PDF_CONTENT_TYPE = "application/pdf";

export type PresignUploadInput = {
  // Consider tightenign the key type to string template literals
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
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  return { uploadUrl, objectKey: key };
}

export function libraryObjectKey(documentId: string): string {
  return `library/${documentId}.pdf`;
}

export function suspectObjectKey(orgId: string, suspectId: string): string {
  return `orgs/${orgId}/suspects/${suspectId}.pdf`;
}
