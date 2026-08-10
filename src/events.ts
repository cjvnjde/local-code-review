/** What the page is told about, so it can follow an agent working without being reloaded. */
export type LiveEvent =
  | { type: "review"; file: string }
  | { type: "diff" }
  | { type: "hello"; file: string };

export type Send = (chunk: string) => void;

/**
 * The open pages. Everything pushed here is advisory: an event says something moved, and the page
 * asks for the new state itself, so a missed or duplicated event costs one extra fetch and nothing more.
 */
export function createHub() {
  const clients = new Set<Send>();
  return {
    /** How many pages are listening; watchers stay idle while this is zero. */
    get size() {
      return clients.size;
    },
    add(send: Send): () => void {
      clients.add(send);
      return () => clients.delete(send);
    },
    emit(event: LiveEvent): void {
      const chunk = `data: ${JSON.stringify(event)}\n\n`;
      for (const send of [...clients]) {
        try {
          send(chunk);
        } catch {
          clients.delete(send); // a page that went away mid-write is simply gone
        }
      }
    },
    ping(): void {
      for (const send of [...clients]) {
        try {
          send(": ping\n\n");
        } catch {
          clients.delete(send);
        }
      }
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
