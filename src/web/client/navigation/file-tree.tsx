import { useMemo } from "react";
import {
  Check,
  FileCode2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Folder,
} from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { fileHidden } from "../diff/filters.ts";
import { useUi } from "../app/ui-preferences.tsx";
import { useStored } from "../app/preferences.ts";
import { Button, cn } from "../components/ui/button.tsx";

type FolderNode = {
  path: string;
  name: string;
  directories: Map<string, FolderNode>;
  files: DiffFile[];
};
export function FileTree({
  files,
  selected,
  scope,
  marks,
  visibility,
  onJump,
  onHide,
  onViewed,
}: {
  files: DiffFile[];
  selected: string;
  scope: string;
  marks: Record<string, string>;
  visibility: Record<string, boolean>;
  onJump: (path: string) => void;
  onHide: (paths: string[], hidden: boolean) => void;
  onViewed: (paths: string[], viewed: boolean) => void;
}) {
  const { settings } = useUi();
  const [folded, setFolded] = useStored<string[]>(
    `lcr:v2:folders:${scope}`,
    [],
  );
  const tree = useMemo(() => {
    const root: FolderNode = {
      path: "",
      name: "",
      directories: new Map(),
      files: [],
    };
    for (const file of files) {
      const parts = file.path.split("/");
      let node = root;
      for (const name of parts.slice(0, -1)) {
        const path = node.path ? `${node.path}/${name}` : name;
        if (!node.directories.has(name))
          node.directories.set(name, {
            path,
            name,
            directories: new Map(),
            files: [],
          });
        node = node.directories.get(name)!;
      }
      node.files.push(file);
    }
    return root;
  }, [files]);
  const hidden = (file: DiffFile) => fileHidden(file, settings, visibility);
  function children(node: FolderNode): React.ReactNode {
    return (
      <>
        {[...node.directories.values()].map((directory) => {
          const descendants = files.filter((file) =>
            file.path.startsWith(directory.path + "/"),
          );
          const closed = folded.includes(directory.path);
          return (
            <div key={directory.path}>
              <div className="group/tree-row relative flex items-center gap-1 rounded hover:bg-accent">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs text-muted-foreground"
                  aria-expanded={!closed}
                  aria-label={`Folder ${directory.path}`}
                  onClick={() =>
                    setFolded((current) =>
                      closed
                        ? current.filter((path) => path !== directory.path)
                        : [...current, directory.path],
                    )
                  }
                >
                  {closed ? (
                    <ChevronRight className="size-3 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3 shrink-0" />
                  )}
                  <Folder className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {directory.name}
                  </span>
                  <span className="shrink-0 text-[10px]">
                    {descendants.length}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Mark folder viewed ${directory.path}`}
                  className="size-8"
                  onClick={() =>
                    onViewed(
                      descendants.map((file) => file.path),
                      !descendants.every(
                        (file) => marks[file.path] === file.hash,
                      ),
                    )
                  }
                >
                  <Check />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Toggle folder visibility ${directory.path}`}
                  className="pointer-events-none absolute right-9 top-1/2 size-7 -translate-y-1/2 bg-card opacity-0 transition-opacity group-hover/tree-row:pointer-events-auto group-hover/tree-row:opacity-100 group-focus-within/tree-row:pointer-events-auto group-focus-within/tree-row:opacity-100"
                  onClick={() =>
                    onHide(
                      descendants.map((file) => file.path),
                      !descendants.every(hidden),
                    )
                  }
                >
                  <Eye />
                </Button>
              </div>
              {!closed && (
                <div className="ml-2 border-l pl-1">{children(directory)}</div>
              )}
            </div>
          );
        })}
        {node.files.map((file) => (
          <div
            key={file.path}
            className="group/tree-row relative mb-1 flex items-center"
          >
            <button
              title={file.path}
              aria-current={selected === file.path ? "true" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent",
                selected === file.path && "bg-primary/10 text-primary",
                hidden(file) && "opacity-50",
              )}
              onClick={() => onJump(file.path)}
            >
              {marks[file.path] === file.hash ? (
                <Check className="size-3 shrink-0 text-emerald-500" />
              ) : (
                <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {file.path.split("/").pop()}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px]",
                  file.status === "added"
                    ? "text-emerald-500"
                    : file.status === "deleted"
                      ? "text-rose-500"
                      : "text-amber-500",
                )}
              >
                {file.status[0]!.toUpperCase()}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="pointer-events-none absolute right-5 top-1/2 size-7 -translate-y-1/2 bg-card opacity-0 transition-opacity group-hover/tree-row:pointer-events-auto group-hover/tree-row:opacity-100 group-focus-within/tree-row:pointer-events-auto group-focus-within/tree-row:opacity-100"
              aria-label={`${hidden(file) ? "Show" : "Hide"} file ${file.path}`}
              onClick={() => onHide([file.path], !hidden(file))}
            >
              {hidden(file) ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        ))}
      </>
    );
  }
  return children(tree);
}
