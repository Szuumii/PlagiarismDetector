import { createTsdownConfig } from "@repo/config/tsdown";

// dts: true emits dist/index.d.ts (re-exporting `AppRouter`). web reads its
// types from that compiled file rather than traversing src/, which avoids
// cross-package conflicts on the `@/*` alias (both api and web use `@/`
// for their own src, so web's tsc can't resolve api's `@/s3` etc.).
export default createTsdownConfig({ dts: true });
