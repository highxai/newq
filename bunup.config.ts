import { defineConfig } from "bunup";

export default defineConfig({
  clean: true,
  dts: true,
  format: ["cjs", "esm"],
  splitting: true,
  target: "node",
  minify: true,
  minifySyntax: true,
  minifyWhitespace: true,
  entry: [
    "./index.ts",
    "./adapters/drizzle-sqlite.ts",
    "./adapters/in-memory.ts",
    "./adapters/mongodb.ts",
    "./adapters/redis.ts",
  ],
});
