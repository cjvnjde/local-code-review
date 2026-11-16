import { transformAsync } from "@babel/core";
import reactCompiler, { type Logger } from "babel-plugin-react-compiler";
import type { BunPlugin } from "bun";

export async function compileReact(
  source: string,
  filename: string,
  logger?: Logger,
) {
  const result = await transformAsync(source, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: {
      plugins: filename.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
    },
    plugins: [[reactCompiler, { target: "19", logger }]],
  });
  if (!result?.code) throw new Error(`React compilation failed: ${filename}`);
  return result.code;
}

/** Run before Bun strips TypeScript/JSX, in both development and release builds. */
const compiler: BunPlugin = {
  name: "react-compiler",
  setup(build) {
    build.onLoad(
      { filter: /[/\\]src[/\\]web[/\\]client[/\\].*\.[jt]sx?$/ },
      async ({ path }) => {
        return {
          contents: await compileReact(await Bun.file(path).text(), path),
          loader: path.endsWith("x") ? "tsx" : "ts",
        };
      },
    );
  },
};

export default compiler;
