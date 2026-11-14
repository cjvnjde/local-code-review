import { ColorTools } from "./colors.tsx";
import { ContextReference } from "./context.tsx";
import { contextId } from "../../../shared/context.ts";
import {
  FileReference,
  NoteReference,
  remarkReferences,
} from "../notes/references.tsx";
import { filePathIn, refIn } from "../notes/note-ref.ts";
import { attachmentSrc, attachmentDownloadSrc } from "./attachments.ts";
import { AttachmentImage } from "./images.tsx";
import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { Code, languageFor } from "./code.tsx";

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
        remarkPlugins={[remarkGfm, remarkReferences]}
        urlTransform={(url, key) =>
          key === "src"
            ? attachmentSrc(url)
              ? url
              : ""
            : contextId(url)
              ? url
              : refIn(url)
                ? `lcr:${refIn(url)}`
                : filePathIn(url)
                  ? url
                  : defaultUrlTransform(url)
        }
        components={{
          p: ({ children }) => <div className="my-2">{children}</div>,
          a: ({ href, children }) =>
            contextId(href) ? (
              <ContextReference source={href!} label={String(children)} />
            ) : refIn(href || "") ? (
              <NoteReference
                reference={refIn(href || "")}
                render={(body, file, captured) => (
                  <Markdown body={body} file={file} captured={captured} />
                )}
              />
            ) : filePathIn(href || "") ? (
              <FileReference path={filePathIn(href || "")}>
                {children}
              </FileReference>
            ) : attachmentDownloadSrc(href || "") ? (
              <a
                href={attachmentDownloadSrc(href!)}
                download={String(children)}
              >
                {children}
              </a>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          img: ({ src, alt }) =>
            src ? (
              <AttachmentImage source={src} label={alt || "Attachment"} />
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
      <ColorTools body={body} />
    </div>
  );
});
