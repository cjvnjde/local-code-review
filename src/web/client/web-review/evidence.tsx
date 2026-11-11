import { splitWebMessage } from "./capture-comparison.ts";
import { Markdown } from "../components/markdown.tsx";
import { webReview, type WebCapture } from "../../../shared/web-review.ts";
import { attachmentSrc } from "../components/markdown.tsx";

function Capture({ capture, label }: { capture: WebCapture; label: string }) {
  const image = capture.proposal || capture.area || capture.page;
  const src = image && attachmentSrc(image);
  return (
    <figure className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <figcaption className="flex items-center gap-2 text-xs font-medium">
        <span>{label}</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(capture.at).toLocaleString()}
        </span>
      </figcaption>
      {src && (
        <a href={src} target="_blank" rel="noreferrer noopener">
          <img
            src={src}
            alt={label}
            className="max-h-80 rounded border object-contain"
            loading="lazy"
          />
        </a>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Selection details</summary>
        <div className="mt-2 space-y-2 break-all">
          <p>{capture.url}</p>
          {(capture.selections || [capture]).map((selection, i) => (
            <div key={i}>
              <code>{selection.selector}</code>
              <p>{selection.element?.text}</p>
              <p>{selection.components.map((c) => c.name).join(" → ")}</p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(selection.element?.styles, null, 2)}
              </pre>
            </div>
          ))}
          {capture.context && (
            <p>
              Saved context: <code>{capture.context.id}</code>
            </p>
          )}
        </div>
      </details>
    </figure>
  );
}
export function WebEvidence({ value }: { value: unknown }) {
  const web = webReview(value);
  if (!web) return null;
  return (
    <div className="my-3 grid gap-3">
      {[web.before, ...(web.additional || [])].map((capture, i) => (
        <Capture
          key={`selection-${i}`}
          capture={capture}
          label={`Selection ${i + 1}`}
        />
      ))}
      {web.after.map((capture, i) => (
        <Capture
          key={`after-${i}`}
          capture={capture}
          label={`After ${i + 1}`}
        />
      ))}
    </div>
  );
}

export function ConversationBody({
  body,
  file,
  captured,
}: {
  body: string;
  file: string;
  captured?: string;
}) {
  return (
    <>
      {splitWebMessage(body).map((part, i) =>
        "web" in part ? (
          <WebEvidence key={i} value={part.web} />
        ) : (
          <Markdown key={i} body={part.text} file={file} captured={captured} />
        ),
      )}
    </>
  );
}
