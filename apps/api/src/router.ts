import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  health: router({
    ping: publicProcedure.query(() => ({
      ok: true as const,
      ts: Date.now(),
    })),
  }),
});

// Only the *type* crosses the api → web boundary. web imports this with
// `import type { AppRouter } from "api"`; the runtime router never ships there.
export type AppRouter = typeof appRouter;
