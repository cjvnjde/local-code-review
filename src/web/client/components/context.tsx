import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Copy } from "lucide-react";
import { Tooltip } from "./ui/tooltip.tsx";
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
        className="flex w-full min-w-0 items-center gap-1 text-left text-primary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
      </button>
      {expanded && (
        <span className="mt-3 block space-y-3">
          <span className="flex items-center gap-1">
            <code
              className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
              title={id}
            >
              {id}
            </code>
            <Tooltip label="Copy context ID">
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label="Copy context ID"
                onClick={() => void navigator.clipboard.writeText(id)}
              >
                <Copy />
              </Button>
            </Tooltip>
          </span>
          {manifest.data && (
            <span className="block text-muted-foreground">
              Captured {manifest.data.at}
              {manifest.data.source?.target
                ? ` · ${manifest.data.source.target}`
                : ""}
            </span>
          )}
          {manifest.isFetching && <span>Loading…</span>}
          {manifest.error && <span role="alert">{manifest.error.message}</span>}
          {manifest.data?.parts.map((part) => (
            <span className="block rounded border p-3" key={part.name}>
              <b>{part.label}</b>
              <code className="ml-2 text-muted-foreground">{part.name}</code>
              <span className="ml-2 text-muted-foreground">
                {part.bytes} bytes · {part.status}
                {part.truncated ? " · partial capture" : ""}
              </span>
              {part.detail && <span className="block">{part.detail}</span>}
              {part.status === "available" &&
                (part.attachment ? (
                  <ContextImage source={part.attachment} label={part.label} />
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
  const [expanded, setExpanded] = useState(false);
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
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(!expanded);
          if (!expanded && !text) void load();
        }}
      >
        <ChevronRight className={`size-3.5 ${expanded ? "rotate-90" : ""}`} />
        Read text
      </Button>
      {expanded && (
        <span className="mt-2 block space-y-2">
          {text && (
            <code className="block whitespace-pre-wrap break-all">{text}</code>
          )}
          {busy && <span role="status">Loading…</span>}
          {offset != null && !busy && (
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {text ? "Read next chunk" : "Retry"}
            </Button>
          )}
          {error && <span role="alert">{error}</span>}
        </span>
      )}
    </span>
  );
}

function ContextImage({ source, label }: { source: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="mt-2 block">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={visible}
        onClick={() => setVisible(!visible)}
      >
        <ChevronRight className={`size-3.5 ${visible ? "rotate-90" : ""}`} />
        View image
      </Button>
      {visible && <AttachmentImage source={source} label={label} />}
    </span>
  );
}
