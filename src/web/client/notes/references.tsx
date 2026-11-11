import { parseColor } from "../components/color-literals.ts";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { ReviewNote } from "../../../shared/review-types.ts";
import { noteKey } from "../../../shared/note-id.ts";
import { noteByRef, refOf } from "./note-ref.ts";
import { Button } from "../components/ui/button.tsx";

const References = createContext<{
  notes: ReviewNote[];
  follow: (note: ReviewNote) => void;
}>({ notes: [], follow: () => {} });
const Nested = createContext(false);
export function ReviewReferences({
  notes,
  follow,
  children,
}: {
  notes: ReviewNote[];
  follow: (note: ReviewNote) => void;
  children: ReactNode;
}) {
  return <References value={{ notes, follow }}>{children}</References>;
}
export const useReferences = () => useContext(References);
export function NoteReference({
  reference,
  render,
}: {
  reference: string;
  render: (body: string, file: string, code?: string) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const { notes, follow } = useReferences();
  const nested = useContext(Nested);
  const note = noteByRef(reference, notes) as ReviewNote | null;
  if (!note && parseColor(`#${reference}`)) return <span>#{reference}</span>;
  if (!note)
    return (
      <span
        className="text-muted-foreground"
        title="This note is no longer in the review"
      >
        #{reference} (unavailable)
      </span>
    );
  if (nested)
    return (
      <button className="text-primary underline" onClick={() => follow(note)}>
        #{reference.slice(-8)} · {noteKey(note)}
      </button>
    );
  return (
    <span className="my-2 block rounded-lg border bg-muted/20 p-3">
      <button
        aria-expanded={expanded}
        className="text-xs text-primary"
        onClick={() => setExpanded(!expanded)}
      >
        #{reference.slice(-8)} · {noteKey(note)}
      </button>
      {expanded && (
        <Nested value={true}>
          <span className="mt-3 block space-y-3">
            <Button size="sm" variant="outline" onClick={() => follow(note)}>
              Go to note
            </Button>
            {note.code && (
              <code className="block max-h-48 overflow-auto whitespace-pre text-xs">
                {note.code}
              </code>
            )}
            {render(note.body, note.file, note.code)}
            {note.messages.map((message, i) => (
              <span key={message.at || i} className="mt-3 block border-l pl-3">
                <b className="text-xs">{message.role}</b>
                {render(message.body, note.file, note.code)}
              </span>
            ))}
          </span>
        </Nested>
      )}
    </span>
  );
}
export function remarkReferences() {
  return (root: any) => {
    function visit(node: any) {
      if (
        ["link", "image", "code", "inlineCode"].includes(node.type) ||
        !node.children
      )
        return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== "text") {
          visit(child);
          return [child];
        }
        const out = [];
        let at = 0;
        for (const match of child.value.matchAll(
          /(?<![\w\\])#([0-9a-z]{6,})\b/g,
        )) {
          if (match.index > at)
            out.push({
              type: "text",
              value: child.value.slice(at, match.index),
            });
          out.push({
            type: "link",
            url: `lcr:${match[1]}`,
            children: [{ type: "text", value: match[0] }],
          });
          at = match.index + match[0].length;
        }
        if (at < child.value.length)
          out.push({ type: "text", value: child.value.slice(at) });
        return out.length ? out : [child];
      });
    }
    visit(root);
  };
}
