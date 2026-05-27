import { defineConfig } from "tsdown";

type Config = Parameters<typeof defineConfig>[0];

export function createTsdownConfig(override?: Config) {
  return defineConfig({
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    clean: true,
    sourcemap: true,
    ...override,
  });
}
