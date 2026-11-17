import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Network, RefreshCw } from "lucide-react";
import {
  RECOMMENDED_PARSER_LABELS,
  type TreeSitterStatus,
} from "../../../shared/tree-sitter.ts";
import { Button } from "../components/ui/button.tsx";
import { request } from "./api.ts";

export function TreeSitterSettings() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["tree-sitter"],
    queryFn: () => request<TreeSitterStatus>("/api/tree-sitter"),
    refetchInterval: (query) =>
      query.state.data?.installation.state === "running" ? 1000 : false,
  });
  const action = useMutation({
    mutationFn: (action: "install" | "refresh") =>
      request<TreeSitterStatus>("/api/tree-sitter", "POST", { action }),
    onSuccess: (status) => client.setQueryData(["tree-sitter"], status),
  });
  const status = query.data;
  const installing = status?.installation.state === "running";
  const busy = installing || action.isPending;
  const failure = action.error || query.error;
  return (
    <section className="space-y-3" aria-labelledby="tree-sitter-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="tree-sitter-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Network aria-hidden="true" className="size-4" /> Tree-sitter
          highlighting
        </h3>
        <Button
          variant="ghost"
          disabled={busy || query.isPending}
          onClick={() => action.mutate("refresh")}
        >
          <RefreshCw aria-hidden="true" /> Check again
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {!status
          ? query.isError
            ? "Tree-sitter status is unavailable."
            : "Checking local installation…"
          : !status.cli
            ? "Tree-sitter CLI was not found on the server’s PATH."
            : status.languages.length
              ? `Tree-sitter detected · ${status.languages.length} language grammars configured.`
              : "Tree-sitter detected · No language parsers configured."}{" "}
        Unsupported files use highlight.js.
      </p>
      {status && !status.enabled && (
        <p className="text-xs text-muted-foreground">
          Disabled for this run. Start lcr with <code>--tree-sitter</code> to
          enable it.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Recommended: {RECOMMENDED_PARSER_LABELS.join(", ")}. Downloads from the
        Tree-sitter projects on GitHub, configures discovery, and compiles the
        parsers. Existing settings are kept.
      </p>
      {!!status?.missingTools.length && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Setup needs: {status.missingTools.join(", ")}.</p>
          {(status.missingTools.includes("tree-sitter") ||
            status.missingTools.includes("bun")) && (
            <p>
              With mise:{" "}
              <code className="select-text">mise use -g tree-sitter bun</code>
            </p>
          )}
          {(status.missingTools.includes("git") ||
            status.missingTools.includes("C compiler")) && (
            <p>
              Install Git and a C compiler using your system’s developer tools.
            </p>
          )}
          <p>Then check again. Restart lcr if its PATH changed.</p>
        </div>
      )}
      <Button
        variant="outline"
        disabled={!status || !!status.missingTools.length || busy}
        onClick={() => action.mutate("install")}
      >
        <Download aria-hidden="true" />{" "}
        {installing ? "Installing parsers…" : "Install recommended parsers"}
      </Button>
      {status && status.installation.state !== "idle" && (
        <p
          role={status.installation.state === "failed" ? "alert" : "status"}
          className={`whitespace-pre-wrap break-words text-xs ${status.installation.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status.installation.detail}
          {status.installation.state === "complete" &&
            status.enabled &&
            " Highlighting refreshed; the footer icon appears when a displayed file uses Tree-sitter."}
        </p>
      )}
      {(failure || status?.error) && (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words text-xs text-destructive"
        >
          {failure?.message || status?.error}
        </p>
      )}
      {status && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-ring">
            CLI and parser details
          </summary>
          <div className="mt-2 space-y-2 break-words">
            {status.cli && (
              <p>
                {status.cli.version}
                <br />
                <code>{status.cli.path}</code>
              </p>
            )}
            <p>
              Install directory: <code>{status.directory}</code>
            </p>
            <p>Configured scopes: {status.languages.join(", ") || "None"}</p>
            <p>
              After installing parsers in a terminal, use Check again to refresh
              highlighting.
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
