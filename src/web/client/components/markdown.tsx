import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { Code, languageFor } from "./code.tsx";

export function attachmentSrc(url: string) {
  const raw = url.trim().replace(/^\.\//, "");
  if (
    !/^(?:(?:images|assets)\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|apng)$/i.test(
      raw,
    )
  )
    return "";
  return `/api/attachment?ref=${encodeURIComponent(raw)}`;
}

function Suggestion({
  value,
  captured,
  file,
}: {
  value: string;
  captured: string;
  file: string;
}) {
  const lines = captured.split("\n");
  const kept = lines.filter((line) => !line.startsWith("-"));
  const base =
    (kept.length ? kept : lines).map((line) => line.slice(1)).join("\n") + "\n";
  return (
    <span className="block suggestion">
      <span className="mb-2 block text-xs font-sans text-muted-foreground">
        Suggested change
      </span>
      {diffLines(base, value).map((part, i) => (
        <span
          key={i}
          className={`block whitespace-pre ${part.added ? "diff-add" : part.removed ? "diff-del" : ""}`}
        >
          <Code
            value={part.value.replace(/\n$/, "")}
            language={languageFor(file)}
          />
        </span>
      ))}
    </span>
  );
}

export const Markdown = memo(function Markdown({
  body,
  file = "",
  captured = "",
}: {
  body: string;
  file?: string;
  captured?: string;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) =>
          key === "src" ? attachmentSrc(url) : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            src ? (
              <a href={src} target="_blank" rel="noreferrer noopener">
                <img src={src} alt={alt || "Attachment"} loading="lazy" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                [Image: {alt || "external image"}]
              </span>
            ),
          code: ({ children, className }) => {
            const value = String(children);
            const language = /language-([\w+-]+)/.exec(className || "")?.[1];
            if (language === "suggestion" && captured)
              return (
                <Suggestion value={value} captured={captured} file={file} />
              );
            if (language || value.includes("\n"))
              return (
                <Code value={value} language={language || languageFor(file)} />
              );
            return <code>{children}</code>;
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
