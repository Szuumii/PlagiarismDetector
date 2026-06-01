import {
  CreateDocumentInputSchema,
  CreateDocumentResponseSchema,
} from "@repo/schemas";

import { libraryObjectKey, presignUploadUrl } from "../s3";
import { publicProcedure, router } from "../trpc";

export const libraryRouter = router({
  documents: router({
    create: publicProcedure
      .input(CreateDocumentInputSchema)
      .output(CreateDocumentResponseSchema)
      .mutation(async ({ ctx, input }) => {
        const documentId = crypto.randomUUID();
        const objectKey = libraryObjectKey(documentId);

        await ctx.db.document.create({
          data: {
            id: documentId,
            title: input.title,
            filename: input.filename,
            s3Key: objectKey,
            status: "pending",
          },
        });

        const { uploadUrl } = await presignUploadUrl({ key: objectKey });

        return { documentId, uploadUrl, objectKey };
      }),

    // TODO: confirmUpload — see plan §7.
  }),
});
