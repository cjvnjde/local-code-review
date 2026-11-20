import { useMemo } from "react";
import {
  Square,
  SquareCheck,
  SquareMinus,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Folder,
} from "lucide-react";
import type { DiffFile } from "../../../shared/review-types.ts";
import { useStored } from "../app/preferences.ts";
import { Button, cn } from "../components/ui/button.tsx";

type FolderNode = {
  path: string;
  name: string;
  directories: Map<string, FolderNode>;
  files: DiffFile[];
  descendants: DiffFile[];
};
function TreeActions({
  kind,
  path,
  hidden,
  viewed,
  onHide,
  onViewed,
}: {
  kind: "file" | "folder";
  path: string;
  hidden: boolean;
  viewed: boolean | "mixed";
  onHide: () => void;
  onViewed: () => void;
}) {
  const visibilityAction = `${hidden ? "Show" : "Hide"} ${kind} ${path}`;
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="file-tree-action size-7 text-muted-foreground hover:bg-card pointer-coarse:size-10"
        data-active={hidden}
        aria-label={
          kind === "folder"
            ? `Toggle folder visibility ${path}`
            : visibilityAction
        }
        title={visibilityAction}
        onClick={onHide}
      >
        {hidden ? <EyeOff /> : <Eye />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="file-tree-action size-7 text-muted-foreground hover:bg-card aria-pressed:text-success pointer-coarse:size-10"
        data-active={viewed !== false}
        aria-label={
          kind === "file" ? `Viewed: ${path}` : `Mark folder viewed ${path}`
        }
        aria-pressed={viewed}
        title={`Mark ${kind} ${viewed === true ? "unviewed" : "viewed"}`}
        onClick={onViewed}
      >
        {viewed === true ? (
          <SquareCheck />
        ) : viewed === "mixed" ? (
          <SquareMinus />
        ) : (
          <Square />
        )}
      </Button>
    </>
  );
}

export function FileTree({
  files,
  selected,
  scope,
  marks,
  hiddenPaths,
  onJump,
  onHide,
  onViewed,
}: {
  files: DiffFile[];
  selected: string;
  scope: string;
  marks: Record<string, string>;
  hiddenPaths: ReadonlySet<string>;
  onJump: (path: string) => void;
  onHide: (paths: string[], hidden: boolean) => void;
  onViewed: (files: readonly DiffFile[], viewed: boolean) => void;
}) {
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
      descendants: [],
    };
    for (const file of files) {
      const parts = file.path.split("/");
      let node = root;
      node.descendants.push(file);
      for (const name of parts.slice(0, -1)) {
        const path = node.path ? `${node.path}/${name}` : name;
        if (!node.directories.has(name))
          node.directories.set(name, {
            path,
            name,
            directories: new Map(),
            files: [],
            descendants: [],
          });
        node = node.directories.get(name)!;
        node.descendants.push(file);
      }
      node.files.push(file);
    }
    return root;
  }, [files]);
  const hidden = (file: DiffFile) => hiddenPaths.has(file.path);
  function children(node: FolderNode): React.ReactNode {
    return (
      <>
        {[...node.directories.values()].map((directory) => {
          const descendants = directory.descendants;
          const closed = folded.includes(directory.path);
          const allHidden = descendants.every(hidden);
          const viewedCount = descendants.reduce(
            (count, file) => count + Number(marks[file.path] === file.hash),
            0,
          );
          const allViewed = viewedCount === descendants.length;
          return (
            <div key={directory.path}>
              <div className="file-tree-row flex items-center rounded pr-1 hover:bg-accent">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 rounded py-2 pr-1 pl-2 text-left text-xs text-muted-foreground"
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
                  <span className="file-tree-meta shrink-0 text-[10px]">
                    {descendants.length}
                  </span>
                </button>
                <TreeActions
                  kind="folder"
                  path={directory.path}
                  hidden={allHidden}
                  viewed={allViewed || (viewedCount > 0 ? "mixed" : false)}
                  onHide={() =>
                    onHide(
                      descendants.map((file) => file.path),
                      !allHidden,
                    )
                  }
                  onViewed={() => onViewed(descendants, !allViewed)}
                />
              </div>
              {!closed && (
                <div className="ml-2 border-l pl-1">{children(directory)}</div>
              )}
            </div>
          );
        })}
        {node.files.map((file) => {
          const isHidden = hidden(file);
          const viewed = marks[file.path] === file.hash;
          return (
            <div
              key={file.path}
              className={cn(
                "file-tree-row mb-1 flex items-center rounded-md pr-1 hover:bg-accent",
                selected === file.path && "bg-primary/10 text-primary",
              )}
            >
              <button
                title={file.path}
                aria-current={selected === file.path ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-1 pl-2 text-left text-xs",
                  isHidden && "opacity-50",
                )}
                onClick={() => onJump(file.path)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {file.path.split("/").pop()}
                </span>
                <span
                  className={cn(
                    "file-tree-meta shrink-0 font-mono text-[10px]",
                    file.status === "added"
                      ? "text-diff-add-foreground"
                      : file.status === "deleted"
                        ? "text-diff-del-foreground"
                        : "text-warning",
                  )}
                >
                  {file.status[0]!.toUpperCase()}
                </span>
              </button>
              <TreeActions
                kind="file"
                path={file.path}
                hidden={isHidden}
                viewed={viewed}
                onHide={() => onHide([file.path], !isHidden)}
                onViewed={() => onViewed([file], !viewed)}
              />
            </div>
          );
        })}
      </>
    );
  }
  return children(tree);
}
