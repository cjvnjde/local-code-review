import tailwind from "bun-plugin-tailwind";
import path from "node:path";

// One pipeline for local checks, standalone builds, and release cross-compilation.
const args = process.argv.slice(2);
const bundle = args.includes("--bundle");
const option = (name: string, fallback: string) => {
  const equal = args.find((arg) => arg.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1] || fallback;
};
const outfile = option("--outfile", "lcr");
const platform = process.platform === "win32" ? "windows" : process.platform;
const target = option("--target", `bun-${platform}-${process.arch}`);
const result = await Bun.build({
  entrypoints: [path.resolve(import.meta.dir, "../src/index.ts")],
  target: "bun",
  minify: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  ...(bundle
    ? { outdir: outfile }
    : {
        compile: {
          target: target as Bun.Build.CompileTarget,
          outfile,
          autoloadBunfig: false,
          autoloadDotenv: false,
        },
      }),
});
for (const log of result.logs) console.error(log);
if (!result.success) {
  process.exit(1);
}
console.log(`${bundle ? "Bundled" : "Compiled"} lcr → ${outfile}`);
