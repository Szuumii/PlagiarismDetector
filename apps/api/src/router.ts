import { analysesRouter } from "./routers/analyses";
import { libraryRouter } from "./routers/library";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: router({
    ping: publicProcedure.query(() => ({
      ok: true as const,
      ts: Date.now(),
    })),
  }),
  library: libraryRouter,
  analyses: analysesRouter
});

// Only the *type* crosses the api → web boundary. web imports this with
// `import type { AppRouter } from "api"`; the runtime router never ships there.
export type AppRouter = typeof appRouter;
