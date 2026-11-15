import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Palette, Save } from "lucide-react";
import {
  THEME_COLORS,
  isThemeColor,
  parseThemeDraft,
  type Theme,
  type ThemeCatalog,
  type ThemeColor,
  type ThemeDraft,
  type ThemeMode,
} from "../../../shared/themes.ts";
import { Button } from "../components/ui/button.tsx";
import { Select } from "../components/ui/select.tsx";
import { request } from "./api.ts";
import { themeStyle, useThemes } from "./themes.tsx";
import { useUi } from "./ui-preferences.tsx";

const groups = [...new Set(THEME_COLORS.map(({ group }) => group))];
const copy = (base: Theme): ThemeDraft => ({
  name: `${base.name.slice(0, 75)} copy`,
  mode: base.mode,
  extends: base.id,
  colors: { ...base.colors },
});

export function ThemeEditor({ baseId }: { baseId: string }) {
  const catalog = useThemes();
  const [snapshot, setSnapshot] = useState<Theme>();
  const base = snapshot ?? catalog.themes.find(({ id }) => id === baseId);
  useEffect(() => {
    if (!snapshot && base && !catalog.loading) setSnapshot(base);
  }, [snapshot, base, catalog.loading]);
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b bg-card px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to review
          </a>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Palette className="size-5 text-primary" /> Theme editor
          </h1>
          <span className="text-xs text-muted-foreground">
            Create a palette of your own
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        {catalog.errors.map((error) => (
          <p key={error} role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        ))}
        {catalog.loading ? (
          <p role="status">Loading themes…</p>
        ) : base ? (
          <Editor base={base} />
        ) : (
          <p role="alert">
            This base theme is unavailable. Return to Settings and choose an
            available theme.
          </p>
        )}
      </div>
    </main>
  );
}

function Editor({ base }: { base: Theme }) {
  const catalog = useThemes();
  const { update } = useUi();
  const client = useQueryClient();
  // Snapshot once: live settings/catalog updates must never overwrite an unsaved palette.
  const [source, setSource] = useState(base);
  const [draft, setDraft] = useState(() => copy(base));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<{ theme: Theme; file: string }>();
  const invalid = THEME_COLORS.filter(
    ({ key }) => !isThemeColor(draft.colors[key]),
  );
  let validation = "";
  try {
    parseThemeDraft(draft);
  } catch (error) {
    validation = (error as Error).message;
  }
  const preview: Theme = {
    ...draft,
    id: "preview",
    colors: { ...draft.colors },
  };
  for (const { key } of invalid) preview.colors[key] = source.colors[key];
  const save = useMutation({
    mutationFn: (value: ThemeDraft) =>
      request<{ theme: Theme; file: string }>(
        "/api/themes",
        "POST",
        parseThemeDraft(value),
      ),
    onSuccess: (result) => {
      setSaved(result);
      setDirty(false);
      client.setQueryData<ThemeCatalog>(["themes"], (current) =>
        current
          ? {
              ...current,
              themes: [
                ...current.themes.filter(({ id }) => id !== result.theme.id),
                result.theme,
              ],
            }
          : current,
      );
      update({ theme: result.theme.id });
      void client.invalidateQueries({ queryKey: ["themes"] });
    },
  });
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || save.isPending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, save.isPending]);
  function change(patch: Partial<ThemeDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSaved(undefined);
    save.reset();
  }
  function color(key: ThemeColor, value: string) {
    change({ colors: { ...draft.colors, [key]: value } });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!validation && !save.isPending) save.mutate(draft);
      }}
    >
      <fieldset disabled={save.isPending} className="min-w-0 space-y-6">
        <legend className="sr-only">Custom theme</legend>
        <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
          <p className="text-sm text-muted-foreground">
            Start from any theme. Every color below includes its usage; the
            preview updates without changing your review until you save.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="block font-medium">Theme name</span>
              <input
                aria-label="Theme name"
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <div className="space-y-2 text-sm">
              <span className="block font-medium">Base palette</span>
              <Select
                label="Base palette"
                value={source.id}
                disabled={save.isPending}
                className="w-full"
                options={catalog.themes.map((theme) => ({
                  value: theme.id,
                  label: theme.name,
                }))}
                onValueChange={(id) => {
                  const next = catalog.themes.find((theme) => theme.id === id);
                  if (
                    !next ||
                    next.id === source.id ||
                    (dirty &&
                      !window.confirm(
                        "Replace your unsaved colors with this base palette?",
                      ))
                  )
                    return;
                  setSource(next);
                  setDraft({ ...copy(next), name: draft.name });
                  setDirty(true);
                  setSaved(undefined);
                  save.reset();
                }}
              />
            </div>
            <div className="space-y-2 text-sm">
              <span className="block font-medium">Color scheme</span>
              <Select<ThemeMode>
                label="Color scheme"
                value={draft.mode}
                disabled={save.isPending}
                className="w-full"
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onValueChange={(mode) => change({ mode })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Light/dark controls native browser controls; it does not replace
            your colors. Saved copies never modify their base theme.
          </p>
        </section>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            {groups.map((group) => (
              <section
                key={group}
                className="rounded-xl border bg-card p-4 sm:p-5"
              >
                <h2 className="mb-2 text-sm font-semibold">{group}</h2>
                <div className="divide-y divide-border">
                  {THEME_COLORS.filter((token) => token.group === group).map(
                    ({ key, label, description }) => (
                      <div
                        key={key}
                        className="flex flex-wrap items-center gap-3 py-4"
                      >
                        <div className="min-w-40 flex-1">
                          <label
                            htmlFor={`theme-${key}`}
                            className="block text-sm font-medium"
                          >
                            {label}
                          </label>
                          <p
                            id={`usage-${key}`}
                            className="mt-1 text-xs leading-relaxed text-muted-foreground"
                          >
                            {description}
                          </p>
                          <code className="mt-1 block text-[10px] text-muted-foreground">
                            --{key}
                          </code>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <input
                            type="color"
                            aria-label={`${label} picker`}
                            aria-describedby={`usage-${key}`}
                            value={preview.colors[key]}
                            onChange={(event) => color(key, event.target.value)}
                            className="size-9 cursor-pointer rounded border bg-background p-1"
                          />
                          <input
                            id={`theme-${key}`}
                            aria-describedby={`usage-${key}`}
                            aria-invalid={!isThemeColor(draft.colors[key])}
                            value={draft.colors[key]}
                            onChange={(event) => color(key, event.target.value)}
                            pattern="#[0-9a-fA-F]{6}"
                            required
                            spellCheck={false}
                            maxLength={7}
                            className="h-9 w-24 rounded-md border bg-background px-2 font-mono text-xs aria-invalid:border-destructive"
                          />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
          <aside className="order-first space-y-4 lg:sticky lg:top-6 lg:order-last">
            <h2 className="text-sm font-semibold">Live preview</h2>
            <ThemePreview theme={preview} />
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Save location:{" "}
                <code className="break-all">
                  {catalog.directory || "User configuration directory / themes"}
                </code>
              </p>
              <p className="text-xs text-muted-foreground">
                All {THEME_COLORS.length} colors are saved as an independent
                JSON theme. Image content and drawing paint colors are not part
                of the UI palette.
              </p>
              <Button
                type="submit"
                disabled={!!validation || save.isPending || !!saved}
                className="w-full"
              >
                <Save /> {save.isPending ? "Saving…" : "Save as new theme"}
              </Button>
              {validation && (
                <p role="alert" className="text-xs text-destructive">
                  {validation}
                </p>
              )}
              {save.error && (
                <p role="alert" className="text-xs text-destructive">
                  Could not save theme: {save.error.message}. Your edits are
                  still here.
                </p>
              )}
              {saved && (
                <p role="status" className="break-words text-xs text-success">
                  Saved “{saved.theme.name}” to{" "}
                  <code className="break-all">{saved.file}</code>. Available in
                  Settings → Theme.
                </p>
              )}
            </div>
          </aside>
        </div>
      </fieldset>
    </form>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <section
      aria-label="Theme preview"
      style={themeStyle(theme)}
      className={`${theme.mode === "dark" ? "dark " : ""}overflow-hidden rounded-xl border bg-background text-foreground shadow-sm`}
    >
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 text-sm">
        <span className="font-semibold">Review changes</span>
        <span className="text-xs text-muted-foreground">{theme.mode}</span>
      </header>
      <div className="space-y-4 p-4">
        <div className="flex gap-3 text-xs">
          <span className="text-diff-add-foreground">+12 additions</span>
          <span className="text-diff-del-foreground">−4 deletions</span>
        </div>
        <div className="overflow-hidden rounded border font-mono text-xs leading-7">
          <div className="bg-card px-3 text-muted-foreground">
            src/example.ts
          </div>
          <div className="diff-del px-3">
            − <span className="hljs-keyword">const</span> count ={" "}
            <span className="hljs-number">1</span>;
          </div>
          <div className="diff-add px-3">
            + <span className="hljs-keyword">const</span> count ={" "}
            <span className="hljs-number">2</span>;
          </div>
          <div className="px-3">
            <span className="hljs-comment">// A fresh perspective</span>
          </div>
          <div className="px-3">
            <span className="hljs-title function_">review</span>(
            <span className="hljs-string">"hello"</span>);
          </div>
        </div>
        <div className="space-y-3 rounded-lg border bg-card p-3 text-xs">
          <div className="flex items-center gap-2 text-success">
            <Check className="size-3" /> Resolved note
          </div>
          <p>
            Looks good.{" "}
            <span className="text-primary underline">View conversation</span>
          </p>
          <div className="rounded border bg-muted p-2 text-muted-foreground">
            Write a review note…
          </div>
          <div className="flex gap-2">
            <span className="rounded bg-primary px-3 py-2 text-primary-foreground">
              Save note
            </span>
            <span className="rounded bg-accent px-3 py-2 text-accent-foreground">
              Cancel
            </span>
          </div>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-warning">Pending</span>
          <span className="text-destructive">Failed action</span>
        </div>
      </div>
    </section>
  );
}
