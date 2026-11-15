import path from "node:path";
import { contextPath, type ContextPart } from "../shared/context.ts";
import { readContext } from "./context.ts";

interface DiscoveryEntry {
  manifest: string;
  at?: string;
  target?: string;
  parts?: Pick<
    ContextPart,
    "name" | "label" | "status" | "bytes" | "truncated" | "detail"
  >[];
  omittedParts?: number;
  unavailable?: string;
}
export interface ContextDiscovery {
  entries: DiscoveryEntry[];
  omittedContexts: number;
}

/** An inventory, never payloads: bound both filesystem work and prompt growth. */
export async function discoverContexts(
  reviewFile: string,
  ids: Iterable<string>,
): Promise<ContextDiscovery> {
  const references = [...new Set(ids)];
  const directory = path.dirname(reviewFile);
  const result: ContextDiscovery = {
    entries: [],
    omittedContexts: references.length,
  };
  for (const id of references.slice(0, 8)) {
    const entry: DiscoveryEntry = { manifest: contextPath(id) };
    try {
      const manifest = await readContext(directory, ".", id);
      if (!manifest)
        entry.unavailable =
          "Manifest missing; not evidence of an empty capture.";
      else {
        entry.at = manifest.at;
        if (manifest.source?.target) entry.target = manifest.source.target;
        entry.parts = [];
        entry.omittedParts = manifest.parts.length;
        // Reserve room for the entry before considering each optional descriptor.
        result.entries.push(entry);
        if (Buffer.byteLength(JSON.stringify(result)) > 6000) {
          result.entries.pop();
          break;
        }
        for (const part of manifest.parts) {
          entry.parts.push({
            name: part.name,
            label: part.label.slice(0, 80),
            status: part.status,
            bytes: part.bytes,
            ...(part.truncated ? { truncated: true } : {}),
            ...(part.detail ? { detail: part.detail.slice(0, 160) } : {}),
          });
          if (Buffer.byteLength(JSON.stringify(result)) > 6000) {
            entry.parts.pop();
            break;
          }
          entry.omittedParts--;
        }
        result.omittedContexts--;
        continue;
      }
    } catch {
      entry.unavailable =
        "Manifest invalid or unreadable; inspect it before relying on its evidence.";
    }
    result.entries.push(entry);
    if (Buffer.byteLength(JSON.stringify(result)) > 6000) {
      result.entries.pop();
      break;
    }
    result.omittedContexts--;
  }
  return result;
}
