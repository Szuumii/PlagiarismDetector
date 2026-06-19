import {
  ConfirmDocumentUploadInputSchema,
  ConfirmDocumentUploadResponseSchema,
  CreateDocumentInputSchema,
  CreateDocumentResponseSchema,
  IndexDocumentJobSchema,
} from "@repo/schemas";

import { storage } from "@repo/storage";
import { TRPCError } from "@trpc/server";

import { publicProcedure, router } from "@/trpc";

export const libraryRouter = router({
  documents: router({
    create: publicProcedure
      .input(CreateDocumentInputSchema)
      .output(CreateDocumentResponseSchema)
      .mutation(async ({ ctx, input }) => {
        const documentId = crypto.randomUUID();
        const objectKey = storage.libraryObjectKey(documentId);

        await ctx.db.document.create({
          data: {
            id: documentId,
            title: input.title,
            filename: input.filename,
            s3Key: objectKey,
            status: "pending",
          },
        });

        const { uploadUrl } = await storage.presignUploadUrl({ key: objectKey });

        return { documentId, uploadUrl, objectKey };
      }),
    confirmUpload: publicProcedure
      .input(ConfirmDocumentUploadInputSchema)
      .output(ConfirmDocumentUploadResponseSchema)
      .mutation(async ({ ctx, input }) => {
        const documentId = input.documentId;

        const doc = await ctx.db.document.findUnique({
          where: { id: documentId },
        });

        if (!doc) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: `No document with id ${input.documentId}`,
          });
        }

        const payload = IndexDocumentJobSchema.parse({
          documentId,
          objectKey: doc.s3Key,
        });

        // TODO: Consider returning jobId from the return object, to ensure it's created
        await ctx.queues.indexDocument.add("index", payload, {
          jobId: documentId,
        });

        return { enqueued: true, jobId: documentId };
      }),
  }),
});
