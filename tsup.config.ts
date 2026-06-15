import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  minify: false,
  // make the built entry a runnable executable
  banner: { js: "#!/usr/bin/env node" },
});
