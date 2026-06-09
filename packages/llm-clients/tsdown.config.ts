import { createTsdownConfig } from "@repo/config/tsdown";

export default createTsdownConfig({
  deps: { neverBundle: ["zod", "ai", "@ai-sdk/anthropic"] },
});
