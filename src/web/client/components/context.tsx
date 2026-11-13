import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  contextId,
  contextLink,
  contextIsText,
} from "../../../shared/context.ts";
import {
  uploadContext,
  fetchContextManifest,
  fetchContextText,
} from "./context-api.ts";
import { AttachmentImage } from "./images.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/select.tsx";

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
export function AddContext({
  onInsert,
  onBusy,
}: {
  onInsert: (value: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("Additional details");
  const [type, setType] = useState<"text/plain" | "application/json">(
    "text/plain",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  async function attach() {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const ref = await uploadContext(
        file.current?.files?.[0] || { text, label, type },
      );
      onInsert(`\n${contextLink(ref)}\n`);
      setText("");
      if (file.current) file.current.value = "";
      if (details.current) details.current.open = false;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <details className="text-xs" ref={details}>
      <summary className="cursor-pointer text-muted-foreground">
        Add context · file, text or JSON
      </summary>
      <div className="mt-3 space-y-3">
        <input
          ref={file}
          type="file"
          aria-label="Context file"
          disabled={busy}
        />
        <label className="block">
          Label
          <input
            className="mt-1 block w-full rounded border bg-background p-2"
            aria-label="Context label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <Select
          label="Context format"
          value={type}
          onValueChange={setType}
          disabled={busy}
          options={[
            { value: "text/plain", label: "Plain text" },
            { value: "application/json", label: "JSON" },
          ]}
        />
        <textarea
          aria-label="Additional context"
          className="block h-32 w-full rounded border bg-background p-3 font-mono"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void attach()}
        >
          {busy ? "Attaching…" : "Attach context"}
        </Button>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
