import { presignUploadUrl, suspectObjectKey } from "@/s3";
import { publicProcedure, router } from "@/trpc";
import { AnalyzeSuspectJobSchema, ConfirmAnalysisUploadInputSchema, ConfirmAnalysisUploadResponseSchema, CreateAnalysisInputSchema, CreateAnalysisResponseSchema } from "@repo/schemas";
import { TRPCError } from "@trpc/server";

export const analysesRouter = router({
  create: publicProcedure
    .input(CreateAnalysisInputSchema)
    .output(CreateAnalysisResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const suspectId = crypto.randomUUID();
      const objectKey = suspectObjectKey(ctx.orgId, suspectId)

      await ctx.db.suspect.create({
        data: {
          id: suspectId,
          orgId: ctx.orgId,
          filename: input.filename,
          s3Key: objectKey,
          status: "pending"
        }
      })


      const { uploadUrl } = await presignUploadUrl({ key: objectKey })

      return { suspectId, uploadUrl, objectKey }
    }),
  confirmUpload: publicProcedure
    .input(ConfirmAnalysisUploadInputSchema)
    .output(ConfirmAnalysisUploadResponseSchema)
    .mutation(async ({ ctx, input }) => {

      const suspect = await ctx.db.suspect.findUnique({ where: { id: input.suspectId, orgId: ctx.orgId } })

      if (!suspect) {
        throw new TRPCError({
          code: "UNPROCESSABLE_CONTENT",
          message: `No suspect with id ${input.suspectId}`,
        });
      }

      const existing = await ctx.db.analysisJob.findFirst({
        where: {
          suspectId: suspect.id,
          orgId: ctx.orgId,
          status: { in: ["pending", "parsing", "searching", "judging"] },
        },
      })
      if (existing) {
        return { analysisJobId: existing.id }
      }

      const [updatedSuspect, analysisJob] = await ctx.db.$transaction([
        ctx.db.suspect.update({ data: { status: 'uploaded' }, where: { id: suspect.id } }),
        ctx.db.analysisJob.create({
          data: { suspectId: suspect.id, orgId: ctx.orgId, status: 'pending' }
        })
      ])

      const payload = AnalyzeSuspectJobSchema.parse({
        orgId: ctx.orgId,
        analysisJobId: analysisJob.id,
        objectKey: updatedSuspect.s3Key
      })

      await ctx.queues.analyzeSuspect.add('analyze', payload, {
        jobId: analysisJob.id
      })

      return { analysisJobId: analysisJob.id }
    })
})
