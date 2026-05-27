import { defineConfig } from "tsdown";

type Config = Parameters<typeof defineConfig>[0];

export function createTsdownConfig(override?: Config) {
  return defineConfig({
    entry: ["src/index.ts"],
    format: "esm",
    // tsdown 0.22 defaults fixedExtension to `platform === "node"` (true),
    // which emits `.mjs`/`.d.mts`. Keep `.js`/`.d.ts` so every package's
    // `main`/`types`/`exports` entry points stay valid.
    fixedExtension: false,
    dts: true,
    clean: true,
    sourcemap: true,
    ...override,
  });
}
