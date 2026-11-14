import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { contextId, contextIsText } from "../../../shared/context.ts";
import { fetchContextManifest, fetchContextText } from "./context-api.ts";
import { AttachmentImage } from "./images.tsx";
import { Button } from "./ui/button.tsx";

export function ContextReference({
  source,
  label,
}: {
  source: string;
  label: string;
}) {
  const id = contextId(source);
  const [expanded, setExpanded] = useState(false);
  const manifest = useQuery({
    queryKey: ["context", id],
    queryFn: () => fetchContextManifest(id),
    enabled: expanded,
  });
  return (
    <span className="my-2 block rounded border p-3 text-xs">
      <button
        className="text-primary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {label} · {expanded ? "Hide" : "Inspect context"}
      </button>
      {expanded && (
        <span className="mt-3 block space-y-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(id)}
          >
            Copy context ID
          </Button>
          <code className="block break-all text-[10px] text-muted-foreground">
            {id}
          </code>
          {manifest.isFetching && <span>Loading…</span>}
          {manifest.error && <span role="alert">{manifest.error.message}</span>}
          {manifest.data?.parts.map((part) => (
            <span className="block rounded border p-3" key={part.name}>
              <b>{part.label}</b>
              <span className="ml-2 text-muted-foreground">
                {part.bytes} bytes · {part.status}
              </span>
              {part.detail && <span className="block">{part.detail}</span>}
              {part.status === "available" &&
                (part.attachment ? (
                  <AttachmentImage
                    source={part.attachment}
                    label={part.label}
                  />
                ) : contextIsText(part.type) ? (
                  <ContextText id={id} name={part.name} />
                ) : null)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
function ContextText({ id, name }: { id: string; name: string }) {
  const [text, setText] = useState("");
  const [offset, setOffset] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    if (offset == null || busy) return;
    setBusy(true);
    setError("");
    try {
      const chunk = await fetchContextText(id, name, offset);
      setText((value) => value + chunk.content);
      setOffset(chunk.nextOffset);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="mt-2 block">
      {text && (
        <code className="block max-h-80 overflow-auto whitespace-pre-wrap break-words">
          {text}
        </code>
      )}
      {offset != null && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Loading…" : text ? "Read next chunk" : "Read text"}
        </Button>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
