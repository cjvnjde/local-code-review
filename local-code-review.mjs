#!/usr/bin/env bun
// local-code-review — local review UI for agent-authored diffs.
// Development:  bun local-code-review.mjs [git diff args...]
//   bun local-code-review.mjs                 # unstaged + staged vs HEAD
//   bun local-code-review.mjs HEAD~3          # last 3 commits
//   bun local-code-review.mjs main...HEAD      # branch vs main
//   bun local-code-review.mjs --staged
// Flags:  --port 7777  --out .review  --context 5
//
// Standalone binary (needs only git at runtime):
//   bun build ./local-code-review.mjs --compile --minify --outfile lcr
//   cross-compile with e.g. --target=bun-linux-x64 | bun-darwin-arm64 | bun-windows-x64

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

const argv = process.argv.slice(2);
let port = 7777;
let outDir = '.review';
let context = 5;
const diffArgs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') port = Number(argv[++i]);
  else if (argv[i] === '--out') outDir = argv[++i];
  else if (argv[i] === '--context') context = Number(argv[++i]);
  else diffArgs.push(argv[i]);
}

const git = async (...args) => {
  const { stdout } = await exec('git', args, { maxBuffer: 1024 * 1024 * 64 });
  return stdout;
};

const repoRoot = (await git('rev-parse', '--show-toplevel')).trim();
process.chdir(repoRoot);

const defaultMode = diffArgs.length === 0;
// Keep review notes out of git without touching the shared .gitignore.
// Only for an in-repo relative --out; an absolute path is outside git's business.
if (!path.isAbsolute(outDir)) {
  try {
    const gitDir = (await git('rev-parse', '--git-dir')).trim();
    const excl = path.join(gitDir, 'info', 'exclude');
    const cur = await readFile(excl, 'utf8').catch(() => '');
    const entry = `/${outDir.replace(/^\.\//, '').replace(/\/$/, '')}/`;
    if (!cur.split('\n').includes(entry)) {
      await mkdir(path.dirname(excl), { recursive: true });
      await writeFile(excl, (cur.endsWith('\n') || !cur ? cur : cur + '\n') + entry + '\n', 'utf8');
    }
  } catch {}
}

const rangeLabel = defaultMode ? 'working tree vs HEAD (incl. untracked)' : diffArgs.join(' ');

async function getDiff() {
  // In default mode, mark untracked files intent-to-add so new files appear in the diff.
  if (defaultMode) await git('add', '-N', '--', '.').catch(() => {});
  const args = defaultMode ? ['HEAD'] : diffArgs;
  const raw = await git('diff', '--no-color', '--no-ext-diff', `-U${context}`, ...args);
  return parseDiff(raw);
}

/** Cheap content fingerprint: a "viewed" mark is dropped when its file's diff no longer hashes the same. */
function fingerprint(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function parseDiff(raw) {
  const files = [];
  let file = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: '', status: 'modified', rows: [], added: 0, removed: 0, body: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    file.body.push(line);

    if (line.startsWith('new file mode')) {
      file.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      file.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p !== '/dev/null') file.path = p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4);
      if (!file.path && p !== '/dev/null') file.path = p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('Binary files')) {
      file.binary = true;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
        file.rows.push({ t: 'hunk', text: line });
      }
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const c = line[0];
    const text = line.slice(1);
    if (c === '+') {
      file.rows.push({ t: 'add', n: newNo++, text });
      file.added++;
    } else if (c === '-') {
      file.rows.push({ t: 'del', o: oldNo++, text });
      file.removed++;
    } else if (c === ' ') {
      file.rows.push({ t: 'ctx', n: newNo++, o: oldNo++, text });
    }
  }
  return files
    .filter((f) => f.path)
    .map((f) => {
      f.hash = fingerprint(f.body.join('\n'));
      delete f.body;
      return f;
    });
}

function renderMarkdown({ general, comments, range }) {
  const byFile = new Map();
  for (const c of comments) {
    if (!byFile.has(c.file)) byFile.set(c.file, []);
    byFile.get(c.file).push(c);
  }
  const out = [];
  out.push('# Review notes');
  out.push('');
  out.push(`Diff under review: \`${range}\``);
  out.push(`Written: ${new Date().toISOString()}`);
  out.push('');
  if (general.trim()) {
    out.push('## Overall');
    out.push('');
    out.push(general.trim());
    out.push('');
  }
  for (const [file, list] of byFile) {
    out.push(`## ${file}`);
    out.push('');
    list.sort((a, b) => a.start - b.start);
    for (const c of list) {
      const loc = c.label || (c.start === c.end ? String(c.start) : `${c.start}-${c.end}`);
      const side = c.side === 'old' ? ' (line numbers before the change)' : '';
      out.push(`### ${file}:${loc}${side}`);
      out.push('');
      if (c.code && c.code.trim()) {
        out.push('```diff');
        out.push(c.code);
        out.push('```');
        out.push('');
      }
      out.push(c.body.trim());
      out.push('');
    }
  }
  out.push('---');
  out.push('');
  out.push(
    'Work through every note above. Fix what you agree with. If a note is wrong or ' +
      'would break something, say so instead of implementing it. Report what you changed per note.',
  );
  out.push('');
  return out.join('\n');
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review</title>
<style>
  /* catppuccin mocha */
  :root{
    --base:#1e1e2e; --mantle:#181825; --crust:#11111b;
    --s0:#313244; --s1:#45475a; --s2:#585b70;
    --ov0:#6c7086; --ov1:#7f849c; --ov2:#9399b2;
    --text:#cdd6f4; --sub1:#bac2de; --sub0:#a6adc8;
    --green:#a6e3a1; --red:#f38ba8; --yellow:#f9e2af; --blue:#89b4fa;
    --mauve:#cba6f7; --peach:#fab387; --teal:#94e2d5; --sky:#89dceb;
    --sapphire:#74c7ec; --lav:#b4befe; --pink:#f5c2e7;

    --bg:var(--base); --panel:var(--base); --panel2:var(--mantle);
    --edge:var(--s0); --edge-hi:var(--s1);
    --ink:var(--text); --ink-dim:var(--sub0); --ink-faint:var(--ov0);
    --add:var(--green); --del:var(--red); --mark:var(--yellow); --accent:var(--blue);
    --add-bg:rgba(166,227,161,.08); --add-gut:rgba(166,227,161,.16); --add-w:rgba(166,227,161,.28);
    --del-bg:rgba(243,139,168,.08); --del-gut:rgba(243,139,168,.16); --del-w:rgba(243,139,168,.28);
    --sel:rgba(137,180,250,.14);
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.5 var(--mono);display:flex;flex-direction:column}
  body.dragging{user-select:none;cursor:row-resize}
  .i{width:12px;height:12px;fill:currentColor;flex:none;display:block}
  header{position:relative;display:flex;align-items:center;gap:14px;padding:9px 14px;border-bottom:1px solid var(--edge);
    background:var(--panel2);flex:none}
  #gear{border:none;background:none;padding:4px 6px;color:var(--ink-faint);display:flex;border-radius:4px}
  #gear:hover,#gear.on{color:var(--ink);background:var(--s0)}
  #settings{position:absolute;right:10px;top:38px;z-index:10;width:340px;background:var(--panel2);
    border:1px solid var(--edge-hi);border-radius:8px;padding:11px 13px;box-shadow:0 14px 34px rgba(0,0,0,.5);
    font-family:var(--sans);font-size:12px;display:flex;flex-direction:column;gap:9px}
  #settings[hidden]{display:none}
  #settings h4{margin:0;font:600 10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}
  #settings label{display:flex;gap:8px;align-items:center;color:var(--ink);cursor:pointer}
  #settings input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;margin:0;flex:none}
  #settings select{background:var(--crust);color:var(--ink);border:1px solid var(--edge-hi);border-radius:4px;
    padding:3px 6px;font:12px var(--sans);margin-left:auto}
  #settings .note{margin:0;color:var(--ink-faint);font-size:11px;line-height:1.45}
  #settings .sub label{color:var(--ink-dim);padding-left:22px}

  #toasts{position:fixed;right:14px;bottom:60px;z-index:20;display:flex;flex-direction:column;gap:6px;align-items:flex-end}
  .toast{display:flex;align-items:center;gap:9px;background:var(--panel2);border:1px solid var(--edge-hi);
    border-left:3px solid var(--green);border-radius:6px;padding:6px 10px;font-family:var(--sans);font-size:12px;
    color:var(--ink);box-shadow:0 10px 26px rgba(0,0,0,.45);max-width:440px}
  .toast.off{border-left-color:var(--peach)}
  .toast .ic{display:flex;color:var(--green)}
  .toast.off .ic{color:var(--peach)}
  .toast .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
  .toast .lbl{color:var(--ink-faint);text-transform:uppercase;font-size:10px;letter-spacing:.05em}
  .toast button{padding:3px 7px;font-size:10px}
  .toast.out{opacity:0;transform:translateY(4px);transition:opacity .18s,transform .18s}
  header b{font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-size:11px}
  header .range{color:var(--mark)}
  header .spacer{flex:1}
  header .hint{color:var(--ink-faint);font-size:11px;font-family:var(--sans)}
  main{flex:1;display:flex;min-height:0}

  nav{width:300px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--edge);background:var(--panel2)}
  .navtop{flex:none;padding:8px;border-bottom:1px solid var(--edge);display:flex;flex-direction:column;gap:6px}
  .navtop input{width:100%;background:var(--crust);color:var(--ink);border:1px solid var(--edge-hi);border-radius:5px;
    padding:5px 8px;font:12px/1.4 var(--sans)}
  .navtop input:focus{outline:none;border-color:var(--accent)}
  .navbtns{display:flex;gap:4px}
  .navbtns button{flex:1;padding:4px 2px;font-size:10px}
  .tree{flex:1;overflow:auto;padding:6px 0 20px}
  .tw{display:flex;align-items:center;gap:5px;padding:2px 8px 2px 0;cursor:pointer;color:var(--ink-dim);
      white-space:nowrap;min-height:22px}
  .tw:hover{background:var(--s0);color:var(--ink)}
  .tw .nm{flex:1;overflow:hidden;text-overflow:ellipsis;font-size:12px}
  .tw.dir .nm{color:var(--ink)}
  .tw.hid .nm{color:var(--ink-faint);text-decoration:line-through}
  .tw.seen .nm{color:var(--ov1)}
  .tw .chev{display:flex;color:var(--ink-faint)}
  .tw .st{width:11px;text-align:center;font-size:10px;font-weight:700}
  .st.added{color:var(--add)} .st.deleted{color:var(--del)} .st.modified{color:var(--mark)} .st.renamed{color:var(--accent)}
  .tw .ct{font-size:10px;color:var(--crust);background:var(--mark);border-radius:8px;padding:0 5px;font-weight:700}
  .tw .eye,.tw .vd,.tw .vf{opacity:0;border:none;background:none;padding:2px;color:var(--ink-faint);display:flex;border-radius:3px}
  .tw:hover .eye,.tw .eye.on,.tw:hover .vd,.tw:hover .vf,.tw .vd.on,.tw .vd.part,.tw .vf.on{opacity:1}
  .tw .eye:hover,.tw .vd:hover,.tw .vf:hover{color:var(--ink);background:var(--s1)}
  .tw .eye.on{color:var(--mark)}
  .tw .vd.on,.tw .vf.on{color:var(--green)}
  .tw .vd.part{color:var(--ov1)}
  .tw.sel{background:var(--s0);box-shadow:inset 2px 0 0 var(--lav)}

  /* we compensate scrollTop by hand when content above the fold resizes; the browser's own
     scroll anchoring would apply the same correction a second time */
  section{flex:1;overflow:auto;overflow-anchor:none;padding:0 0 40vh;scroll-behavior:auto}
  /* clip, not hidden: overflow hidden would make each card its own scrollport and kill the sticky header */
  #diff .file{border:1px solid var(--edge);border-radius:6px;margin:10px 12px;overflow:clip;background:var(--panel)}
  #diff .file.seen{opacity:.72}
  #diff .file.seen:hover{opacity:1}
  .fh{position:sticky;top:0;z-index:2;background:var(--panel2);padding:6px 10px;border-bottom:1px solid var(--edge);
      display:flex;gap:8px;align-items:center;box-shadow:0 1px 0 var(--crust)}
  #diff .file.fold .fh{border-bottom:none}
  .fh .fchev{border:none;background:none;color:var(--ink-dim);padding:2px;display:flex;border-radius:3px}
  .fh .fchev:hover{background:var(--s1);color:var(--ink)}
  .fh .p{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fh .s{font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.05em}
  .fh .plus{color:var(--add);font-size:11px}
  .fh .minus{color:var(--del);font-size:11px}
  .fh .spacer{flex:1}
  .fh .eye,.fh .vw{border:none;background:none;color:var(--ink-faint);padding:3px 5px;display:flex;gap:5px;align-items:center;
    font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-radius:3px}
  .fh .eye:hover,.fh .vw:hover{color:var(--ink);background:var(--s1)}
  .fh .vw.on{color:var(--green)}
  .fh .stale{color:var(--peach);font-size:10px;text-transform:uppercase;letter-spacing:.05em}

  table{width:100%;border-collapse:collapse;table-layout:fixed}
  #diff .file.fold table{display:none}
  tr.r{height:20px}
  td{padding:0;vertical-align:top;white-space:pre-wrap;word-break:break-word;tab-size:2}
  td.act{padding:0;text-align:center;border-right:1px solid var(--edge)}
  td.act button{opacity:0;border:none;border-radius:3px;background:var(--accent);color:var(--crust);padding:1px;
    margin:1px 0 0;display:inline-flex;cursor:pointer}
  tr.r:hover td.act button{opacity:1}
  td.act button:focus-visible{opacity:1;outline:2px solid var(--mark);outline-offset:1px}
  td.g{text-align:right;padding:0 7px 0 4px;color:var(--ink-faint);user-select:none;font-size:11px;cursor:pointer}
  td.gn{border-right:1px solid var(--edge)}
  tr.r:hover td.g{color:var(--ink-dim)}
  td.c{padding:0 10px}
  tr.add td.g{background:var(--add-gut)} tr.add td.c{background:var(--add-bg)}
  tr.add td.c::before{content:"+";color:var(--add);margin-right:6px}
  tr.del td.g{background:var(--del-gut)} tr.del td.c{background:var(--del-bg)}
  tr.del td.c::before{content:"-";color:var(--del);margin-right:6px}
  tr.ctx td.c::before{content:" ";margin-right:6px}
  tr.hunk td{color:var(--sapphire);background:var(--mantle);padding:2px 10px;font-size:11px;
    border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)}
  tr.ph td{padding:0;background:none;border:none}
  tbody.blk{contain:layout paint}
  tr.r:hover td.c{filter:brightness(1.22)}
  tr.sel td.c,tr.sel td.g{background:var(--sel)}
  tr.noted td.act{box-shadow:inset 3px 0 0 var(--mark)}

  /* delta-style word diff inside a changed line */
  td.c .w{background:var(--add-w);border-radius:2px}
  tr.del td.c .w{background:var(--del-w)}
  /* syntax tokens */
  td.c .k{color:var(--mauve)}
  td.c .s{color:var(--green)}
  td.c .n{color:var(--peach)}
  td.c .t{color:var(--yellow)}
  td.c .f{color:var(--blue)}
  td.c .y{color:var(--sapphire)}
  td.c .p{color:var(--ov2)}
  td.c .m{color:var(--ov0);font-style:italic}
  td.c .h{color:var(--mauve);font-weight:600}
  td.c .l{color:var(--blue)}
  td.c .b{color:var(--sub1);font-weight:600}
  td.c .v{color:var(--teal)}

  tr.nrow td{padding:0;background:var(--base)}
  .nbox{margin:6px 8px 8px 24px;border:1px solid var(--edge-hi);border-radius:6px;background:var(--panel2);overflow:hidden}
  .nhead{display:flex;align-items:center;gap:8px;padding:5px 9px;border-bottom:1px solid var(--edge);
    background:var(--s0);font-size:11px;color:var(--ink-dim)}
  .nhead .loc{color:var(--mark)}
  .nhead .spacer{flex:1}
  .nbody{padding:8px 10px;white-space:pre-wrap;font-family:var(--sans);font-size:13px;line-height:1.55}
  .nedit{padding:8px}
  .nedit textarea{width:100%;background:var(--crust);color:var(--ink);border:1px solid var(--edge-hi);border-radius:5px;
    padding:6px 8px;font:13px/1.55 var(--sans);resize:vertical;min-height:64px;display:block}
  .nedit textarea:focus{outline:none;border-color:var(--accent)}
  .acts{display:flex;gap:6px;margin-top:6px;align-items:center}
  .acts .spacer{flex:1}
  .acts .tip{color:var(--ink-faint);font-size:10px;font-family:var(--sans)}

  button{font:11px/1 var(--mono);letter-spacing:.05em;text-transform:uppercase;background:transparent;color:var(--ink-dim);
    border:1px solid var(--edge-hi);padding:5px 9px;border-radius:5px;cursor:pointer}
  button:hover{color:var(--ink);border-color:var(--ink-faint)}
  button.primary{background:var(--accent);border-color:var(--accent);color:var(--crust);font-weight:600}
  button.primary:hover{background:var(--lav);color:var(--crust)}
  button.danger:hover{color:var(--del);border-color:var(--del)}
  button:focus-visible,td.g:focus-visible{outline:2px solid var(--mark);outline-offset:2px}

  footer{flex:none;border-top:1px solid var(--edge);background:var(--panel2);padding:9px 14px;display:flex;gap:12px;align-items:center}
  footer .count{color:var(--mark);flex:none}
  footer .spacer{flex:1}
  #general{flex:1;max-width:560px;background:var(--crust);color:var(--ink);border:1px solid var(--edge-hi);border-radius:5px;
    padding:6px 8px;font:12px/1.5 var(--sans);height:34px;resize:vertical}
  #general:focus{outline:none;border-color:var(--accent)}
  .empty{padding:34px 16px;color:var(--ink-faint);font-family:var(--sans)}
  .done{padding:40px 20px;font-family:var(--sans);font-size:14px;line-height:1.7}
  .done code{color:var(--mark);background:var(--mantle);padding:2px 6px;border-radius:4px;font-family:var(--mono)}
  @media (prefers-reduced-motion:no-preference){
    tr.nrow .nbox{animation:in .12s ease-out}
    @keyframes in{from{opacity:0;transform:translateY(-2px)}}
  }
</style>
</head>
<body>
<header>
  <b>git review</b>
  <span class="range" id="range"></span>
  <span class="spacer"></span>
  <span class="hint">click a line to comment &middot; drag or shift-click for a range &middot; cmd/ctrl+enter saves</span>
  <button id="gear" title="Settings"></button>
  <div id="settings" hidden>
    <h4>Automatic viewed</h4>
    <label><input type="checkbox" id="cfgAuto"> Mark a file viewed once I scroll past it</label>
    <div class="sub"><label><input type="checkbox" id="cfgBack"> Unmark it when I scroll back up to it</label></div>
    <label>Ignore scrolling faster than <select id="cfgLimit">
      <option value="500">very slow</option>
      <option value="900">slow</option>
      <option value="1800">medium</option>
      <option value="0">any speed</option>
    </select></label>
    <label><input type="checkbox" id="cfgToast"> Show a notification when it happens</label>
    <p class="note">A file counts as scrolled past when its last line leaves the top of the pane.
      Collapsed files are skipped, and marks you set by hand are never undone automatically.</p>
  </div>
</header>
<main>
  <nav>
    <div class="navtop">
      <input id="filter" placeholder="Filter files" spellcheck="false">
      <div class="navbtns">
        <button data-all="expand" title="Expand every folder">Expand</button>
        <button data-all="collapse" title="Collapse every folder">Collapse</button>
        <button data-all="show" title="Show every file in the diff">Show all</button>
        <button data-all="hide" title="Hide every file from the diff">Hide all</button>
      </div>
    </div>
    <div class="tree" id="tree"></div>
  </nav>
  <section id="diff"></section>
</main>
<div id="toasts"></div>
<footer>
  <span class="count" id="count">0 notes</span>
  <textarea id="general" placeholder="Overall note (optional)"></textarea>
  <span class="spacer"></span>
  <button id="reload">Reload diff</button>
  <button class="primary" id="submit">Save review</button>
</footer>
<script>
const SVG={
  chevD:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6h9l-4.5 5z"/></svg>',
  chevR:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l5 4.5-5 4.5z"/></svg>',
  eye:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.6 3 1.8 5.5 1 8c.8 2.5 3.6 5 7 5s6.2-2.5 7-5c-.8-2.5-3.6-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4Zm0-1.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z"/></svg>',
  eyeOff:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.6 3 1.8 5.5 1 8c.8 2.5 3.6 5 7 5s6.2-2.5 7-5c-.8-2.5-3.6-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4Z"/><path d="M2.4 1.1 14.9 13.6l-1.3 1.3L1.1 2.4z"/></svg>',
  plus:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z"/></svg>',
  box:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h11.6v11.6H2.2z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  boxOn:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h11.6v11.6H2.2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 8.1l2.3 2.3 4.5-4.7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  check:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 12.4 2 8.3l1.3-1.3 2.8 2.8 6.6-6.6L14 4.5z"/></svg>',
  sliders:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.6h4.4V5H2zM9.6 3.6H14V5H9.6zM2 11h4.4v1.4H2zM9.6 11H14v1.4H9.6z"/><path d="M6.6 1.8h1.5v5.1H6.6zM9.1 9.2h1.5v5.1H9.1z"/></svg>',
};

const state={
  files:[], range:'', notes:new Map(),
  hidden:new Set(), collapsed:new Set(), folded:new Set(), viewed:new Map(),
  filter:'', sel:null,
  byPath:new Map(), h:new Map(), draftRow:null,
  cfg:{auto:true,back:true,limit:900,toast:true},
  scrolled:false, jumpUntil:0, autoNow:new Set(), lastUndo:0,
};
const el=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rowKey=r=>r.n!=null?'n'+r.n:'o'+r.o;
const noteId=(p,a,b)=>p+'|'+a+'|'+b;

/* ---------- persistence ---------- */
const CFG_KEY='gitreview:settings';
function loadCfg(){
  try{ Object.assign(state.cfg,JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){}
  el('cfgAuto').checked=state.cfg.auto;
  el('cfgBack').checked=state.cfg.back;
  el('cfgToast').checked=state.cfg.toast;
  el('cfgLimit').value=String(state.cfg.limit);
  el('cfgBack').disabled=!state.cfg.auto;
}
function saveCfg(){
  state.cfg.auto=el('cfgAuto').checked;
  state.cfg.back=el('cfgBack').checked;
  state.cfg.toast=el('cfgToast').checked;
  state.cfg.limit=Number(el('cfgLimit').value);
  el('cfgBack').disabled=!state.cfg.auto;
  try{ localStorage.setItem(CFG_KEY,JSON.stringify(state.cfg)); }catch(e){}
}
const store=()=>'gitreview:'+state.range;
function save(){
  try{
    localStorage.setItem(store(),JSON.stringify({
      general:el('general').value,
      notes:[...state.notes.values()],
      hidden:[...state.hidden], collapsed:[...state.collapsed], folded:[...state.folded],
      viewed:[...state.viewed],
    }));
  }catch(e){}
}
function restore(){
  try{
    const d=JSON.parse(localStorage.getItem(store())||'null');
    if(!d) return;
    el('general').value=d.general||'';
    (d.notes||[]).forEach(n=>{ n.id=noteId(n.file,n.a,n.b); state.notes.set(n.id,n); });
    state.hidden=new Set(d.hidden||[]);
    state.collapsed=new Set(d.collapsed||[]);
    state.folded=new Set(d.folded||[]);
    state.viewed=new Map((d.viewed||[]).map(e=>[e[0],typeof e[1]==='string'?{h:e[1],auto:false}:e[1]]));
  }catch(e){}
}
/** A viewed mark only holds while the file's diff is byte-identical to what was reviewed. */
function pruneViewed(){
  const stale=[];
  state.viewed.forEach((v,p)=>{
    const i=idxOf(p);
    if(i<0||state.files[i].hash!==v.h) stale.push(p);
  });
  stale.forEach(p=>{ state.viewed.delete(p); state.folded.delete(p); });
  return stale;
}

/* ---------- load ---------- */
async function load(){
  const r=await fetch('/api/diff');
  const d=await r.json();
  if(!r.ok||d.error){
    el('diff').innerHTML='<div class="empty">git could not produce this diff:<br><br>'+esc(d.error||'unknown error')+
      '<br><br>Restart the server with different arguments.</div>';
    return;
  }
  state.files=d.files; state.range=d.range;
  state.byPath=new Map(d.files.map((f,i)=>[f.path,i]));
  state.h.clear(); state.tree=null;
  el('range').textContent=d.range;
  if(!state.loaded){ restore(); state.loaded=true; }
  state.stale=new Set(pruneViewed());
  save();
  render();
}
const idxOf=p=>state.byPath.has(p)?state.byPath.get(p):-1;

function render(){ renderTree(); renderDiff(); updateCount(); }

/* ---------- file tree ---------- */
function dirTree(){
  if(!state.tree) state.tree=buildTree(state.files);
  return state.tree;
}
function buildTree(files){
  const root={dir:true,name:'',path:'',children:new Map()};
  files.forEach(f=>{
    const parts=f.path.split('/');
    let node=root;
    parts.forEach((p,pi)=>{
      if(pi===parts.length-1){ node.children.set(p,{dir:false,name:p,path:f.path,file:f,idx:idxOf(f.path)}); return; }
      if(!node.children.has(p)) node.children.set(p,{dir:true,name:p,path:(node.path?node.path+'/':'')+p,children:new Map()});
      node=node.children.get(p);
    });
  });
  squash(root);
  return root;
}
function squash(node){
  node.children.forEach(c=>{
    if(!c.dir) return;
    while(c.children.size===1){
      const only=[...c.children.values()][0];
      if(!only.dir) break;
      c.name=c.name+'/'+only.name; c.path=only.path; c.children=only.children;
    }
    squash(c);
  });
}
function filesUnder(node,out){
  out=out||[];
  node.children.forEach(c=>c.dir?filesUnder(c,out):out.push(c.path));
  return out;
}
function noteCount(p){ let n=0; state.notes.forEach(v=>{ if(v.file===p) n++; }); return n; }

function renderTree(){
  const root=state.filter?buildTree(state.files.filter(f=>f.path.toLowerCase().includes(state.filter))):dirTree();
  const html=[];
  const walk=(node,depth)=>{
    [...node.children.values()]
      .sort((a,b)=>a.dir===b.dir?a.name.localeCompare(b.name):a.dir?-1:1)
      .forEach(c=>{
        const pad=8+depth*13;
        if(c.dir){
          const open=state.filter||!state.collapsed.has(c.path);
          const kids=filesUnder(c);
          const allHidden=kids.length>0&&kids.every(p=>state.hidden.has(p));
          const notes=kids.reduce((s,p)=>s+noteCount(p),0);
          const seen=kids.filter(p=>state.viewed.has(p)).length;
          const allSeen=kids.length>0&&seen===kids.length;
          html.push('<div class="tw dir'+(allHidden?' hid':'')+(allSeen?' seen':'')+'" data-dir="'+esc(c.path)+'" style="padding-left:'+pad+'px">'+
            '<span class="chev">'+(open?SVG.chevD:SVG.chevR)+'</span>'+
            '<span class="nm">'+esc(c.name)+'</span>'+
            (notes?'<span class="ct">'+notes+'</span>':'')+
            '<button class="vd'+(allSeen?' on':seen?' part':'')+'" data-vd="'+esc(c.path)+'" title="'+
              (allSeen?'Mark these '+kids.length+' files not viewed':'Mark all '+kids.length+' files viewed')+
              (seen&&!allSeen?' ('+seen+'/'+kids.length+' viewed)':'')+'">'+(allSeen?SVG.boxOn:SVG.box)+'</button>'+
            '<button class="eye'+(allHidden?' on':'')+'" data-hd="'+esc(c.path)+'" title="'+
              (allHidden?'Show these files in the diff':'Hide these files from the diff')+'">'+
              (allHidden?SVG.eyeOff:SVG.eye)+'</button></div>');
          if(open) walk(c,depth+1);
        }else{
          const f=c.file, hid=state.hidden.has(c.path), notes=noteCount(c.path), seen=state.viewed.has(c.path);
          html.push('<div class="tw file'+(hid?' hid':'')+(seen?' seen':'')+'" data-file="'+esc(c.path)+'" data-idx="'+c.idx+'" '+
            'title="'+esc(c.path)+' (+'+f.added+' -'+f.removed+')" style="padding-left:'+pad+'px">'+
            '<span class="st '+f.status+'">'+f.status[0].toUpperCase()+'</span>'+
            '<span class="nm">'+esc(c.name)+'</span>'+
            (notes?'<span class="ct">'+notes+'</span>':'')+
            '<button class="vf'+(seen?' on':'')+'" data-vf="'+esc(c.path)+'" title="'+
              (seen?'Mark not viewed':'Mark viewed')+'">'+(seen?SVG.boxOn:SVG.box)+'</button>'+
            '<button class="eye'+(hid?' on':'')+'" data-hf="'+esc(c.path)+'" title="'+
              (hid?'Show in diff':'Hide from diff')+'">'+(hid?SVG.eyeOff:SVG.eye)+'</button></div>');
        }
      });
  };
  walk(root,0);
  el('tree').innerHTML=html.join('')||'<div class="empty">No files match.</div>';
}

/* ---------- syntax colouring (line-scoped, delta-ish) ---------- */
const KW_TS='const let var function return if else for while do switch case break continue import export from as default '+
  'class extends implements interface type enum new await async try catch finally throw typeof instanceof in of delete void '+
  'yield public private protected readonly static get set this super null undefined true false satisfies keyof infer declare '+
  'namespace abstract override require module';
const KW_PY='def class return if elif else for while import from as pass break continue try except finally raise with lambda '+
  'global nonlocal yield async await None True False not and or in is del assert';
const KW_SH='if then else elif fi for while do done case esac function return local export unset echo cd exit source set trap shift read';
// \x60 is a backtick: this source lives inside a raw template literal, so it cannot contain one.
const STR='("(?:[^"\\\\]|\\\\.)*"?|\'(?:[^\'\\\\]|\\\\.)*\'?|\x60(?:[^\x60\\\\]|\\\\.)*\x60?)';
const RULES={
  ts:['(\\/\\/.*|\\/\\*.*?\\*\\/|\\/\\*.*)','m',STR,'s','(\\b(?:'+KW_TS.split(' ').join('|')+')\\b)','k',
      '(\\b0[xXbBoO][\\da-fA-F_]+|\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[-+]?\\d+)?)','n',
      '([A-Za-z_$][\\w$]*(?=\\s*[(<]))','f','(\\b[A-Z][\\w$]*)','t','([{}\\[\\]();,.:?!=+\\-*/%<>&|^~]+)','p'],
  json:['("(?:[^"\\\\]|\\\\.)*"(?=\\s*:))','y',STR,'s','(\\b(?:true|false|null)\\b)','k','(-?\\b\\d[\\d.eE+-]*)','n','([{}\\[\\],:]+)','p'],
  css:['(\\/\\*.*?\\*\\/|\\/\\*.*)','m',STR,'s','(@[\\w-]+)','k','([-\\w]+(?=\\s*:))','y',
       '(#[\\da-fA-F]{3,8}\\b|\\b\\d[\\d.]*(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\\b)','n','([{}();:,>+~]+)','p'],
  md:['(^\\s*#{1,6}\\s.*)','h','(\x60\x60\x60.*|~~~.*)','k','(\x60[^\x60]*\x60)','s',
      '(\\*\\*[^*]+\\*\\*|__[^_]+__)','b','(\\[[^\\]]*\\]\\([^)]*\\))','l','(^\\s*[-*+]\\s|^\\s*\\d+\\.\\s)','p'],
  yaml:['(#.*)','m','(^\\s*-?\\s*[\\w.$-]+(?=\\s*:))','y',STR,'s','(\\b(?:true|false|null|yes|no|on|off)\\b)','k','(\\b\\d[\\d.]*\\b)','n','([-:|>&*]+)','p'],
  sh:['(#.*)','m',STR,'s','(\\b(?:'+KW_SH.split(' ').join('|')+')\\b)','k','(\\$\\{?[\\w@#?*-]+\\}?)','v','(\\s--?[\\w-]+)','y','(\\b\\d+\\b)','n','([|&;()<>{}=]+)','p'],
  py:['(#.*)','m',STR,'s','(\\b(?:'+KW_PY.split(' ').join('|')+')\\b)','k','(@[\\w.]+)','y',
      '(\\b\\d[\\d._eE+-]*)','n','([A-Za-z_][\\w]*(?=\\s*\\())','f','(\\b[A-Z][\\w]*)','t','([{}\\[\\]();,.:=+\\-*/%<>&|^~]+)','p'],
  html:['(<!--.*?-->|<!--.*)','m','(<\\/?[\\w:-]+)','k',STR,'s','([\\w:-]+(?==))','y','([<>\\/=]+)','p'],
  txt:[STR,'s','(#.*)','m','(\\b\\d[\\d.]*\\b)','n'],
};
const RX={};
function rxFor(lang){
  if(!RX[lang]){
    const r=RULES[lang]||RULES.txt, pats=[], cls=[];
    for(let i=0;i<r.length;i+=2){ pats.push(r[i]); cls.push(r[i+1]); }
    RX[lang]={re:new RegExp(pats.join('|'),'g'),cls};
  }
  return RX[lang];
}
function langOf(p){
  const e=(p.split('/').pop().split('.').pop()||'').toLowerCase();
  if('ts tsx js jsx mjs cjs mts cts'.split(' ').includes(e)) return 'ts';
  if(e==='json'||e==='jsonc') return 'json';
  if('css scss less'.split(' ').includes(e)) return 'css';
  if('md mdx markdown'.split(' ').includes(e)) return 'md';
  if(e==='yml'||e==='yaml') return 'yaml';
  if('sh bash zsh fish'.split(' ').includes(e)) return 'sh';
  if(e==='py') return 'py';
  if('html htm vue svelte xml'.split(' ').includes(e)) return 'html';
  return 'txt';
}
function tokens(text,lang){
  // A continuation line of a block comment has no opener on this line, so match it by shape.
  if((lang==='ts'||lang==='css')&&/^\s*\*/.test(text)) return [{s:0,e:text.length,c:'m'}];
  const {re,cls}=rxFor(lang), out=[];
  let last=0,m;
  re.lastIndex=0;
  while((m=re.exec(text))){
    if(!m[0]){ re.lastIndex++; continue; }
    if(m.index>last) out.push({s:last,e:m.index,c:''});
    let g=1;
    while(g<m.length&&m[g]===undefined) g++;
    out.push({s:m.index,e:m.index+m[0].length,c:cls[g-1]||''});
    last=re.lastIndex;
  }
  if(last<text.length) out.push({s:last,e:text.length,c:''});
  return out;
}
function codeHtml(text,lang,wr){
  if(!text) return '';
  let out='';
  for(const t of tokens(text,lang)){
    let s=t.s;
    while(s<t.e){
      let e=t.e,inW=false;
      if(wr){
        if(s<wr[0]) e=Math.min(e,wr[0]);
        else if(s<wr[1]){ inW=true; e=Math.min(e,wr[1]); }
      }
      const seg=esc(text.slice(s,e));
      const cls=(t.c||'')+(inW?(t.c?' w':'w'):'');
      out+=cls?'<span class="'+cls+'">'+seg+'</span>':seg;
      s=e;
    }
  }
  return out;
}

/* ---------- word-level diff: pair del/add runs, keep only the middle that really changed ---------- */
const WORDY=c=>c!=null&&/[\w$]/.test(c);
function diffRange(o,n){
  if(o===n) return null;
  const m=Math.min(o.length,n.length);
  let s=0;
  while(s<m&&o[s]===n[s]) s++;
  let t=0;
  while(t<m-s&&o[o.length-1-t]===n[n.length-1-t]) t++;
  const longest=Math.max(o.length,n.length);
  if(longest&&(s+t)/longest<0.2) return null; // barely related — colour the whole line instead
  const grow=(str,a,b)=>{
    while(a>0&&WORDY(str[a-1])&&WORDY(str[a])) a--;
    while(b<str.length&&WORDY(str[b-1])&&WORDY(str[b])) b++;
    return a<b?[a,b]:null;
  };
  return {o:grow(o,s,o.length-t),n:grow(n,s,n.length-t)};
}
function sim(o,n){
  if(o===n) return 1;
  const m=Math.min(o.length,n.length);
  let s=0;
  while(s<m&&o[s]===n[s]) s++;
  let t=0;
  while(t<m-s&&o[o.length-1-t]===n[n.length-1-t]) t++;
  const L=Math.max(o.length,n.length);
  return L?(s+t)/L:0;
}
function wordDiff(f){
  if(f.wd) return f.wd;
  const w=new Map(), rows=f.rows;
  let i=0;
  while(i<rows.length){
    if(rows[i].t!=='del'){ i++; continue; }
    let d=i;
    while(d<rows.length&&rows[d].t==='del') d++;
    let a=d;
    while(a<rows.length&&rows[a].t==='add') a++;
    const dn=d-i, an=a-d, pairs=[];
    if(dn===an){ for(let k=0;k<dn;k++) pairs.push([i+k,d+k]); }
    else if(dn*an>0&&dn*an<=256){
      // Unequal runs: match each removed line to its likeliest replacement rather than by position.
      const used=new Set();
      for(let k=0;k<dn;k++){
        let best=-1,score=0;
        for(let q=0;q<an;q++){
          if(used.has(q)) continue;
          const s=sim(rows[i+k].text,rows[d+q].text);
          if(s>score){ score=s; best=q; }
        }
        if(best>=0&&score>=0.3){ used.add(best); pairs.push([i+k,d+best]); }
      }
    }else{
      for(let k=0;k<Math.min(dn,an);k++) pairs.push([i+k,d+k]);
    }
    pairs.forEach(pr=>{
      const r=diffRange(rows[pr[0]].text,rows[pr[1]].text);
      if(!r) return;
      if(r.o) w.set(pr[0],r.o);
      if(r.n) w.set(pr[1],r.n);
    });
    i=Math.max(a,d);
  }
  f.wd=w;
  return w;
}

/* ---------- diff: rows live in lazily mounted blocks so huge diffs stay cheap ---------- */
const BLOCK=150, ROW_H=20;
const blockCount=f=>Math.max(1,Math.ceil(f.rows.length/BLOCK));
const blockEnd=(f,b)=>Math.min(f.rows.length,b*BLOCK+BLOCK);
function blockH(f,b){
  const m=state.h.get(f.path+'|'+b);
  return m!=null?m:(blockEnd(f,b)-b*BLOCK)*ROW_H;
}
const phHtml=h=>'<tr class="ph"><td colspan="4" style="height:'+h+'px"></td></tr>';

function renderDiff(){
  const sec=el('diff');
  obsMount.disconnect(); obsDrop.disconnect();
  if(!state.files.length){ sec.innerHTML='<div class="empty">No changes in this diff. Nothing to review.</div>'; return; }
  const shown=state.files.map((f,i)=>i).filter(i=>!state.hidden.has(state.files[i].path));
  if(!shown.length){
    sec.innerHTML='<div class="empty">Every file is hidden. Use the eye icons in the tree to bring them back.</div>';
    return;
  }
  sec.innerHTML=shown.map(i=>fileHtml(state.files[i],i)).join('');
  sec.querySelectorAll('tbody.blk').forEach(observeBlock);
  sec.querySelectorAll('.file').forEach(n=>obsPass.observe(n));
}

function fileHtml(f,fi){
  const folded=state.folded.has(f.path), seen=state.viewed.has(f.path);
  const cls='file'+(folded?' fold':'')+(seen?' seen':'');
  const head='<div class="fh">'+
    '<button class="fchev" data-fold="'+esc(f.path)+'" title="'+(folded?'Expand file':'Collapse file')+'">'+
      (folded?SVG.chevR:SVG.chevD)+'</button>'+
    '<span class="p">'+esc(f.path)+'</span>'+
    '<span class="s">'+f.status+'</span>'+
    '<span class="plus">+'+f.added+'</span><span class="minus">-'+f.removed+'</span>'+
    (state.stale&&state.stale.has(f.path)?'<span class="stale">changed since viewed</span>':'')+
    '<span class="spacer"></span>'+
    '<button class="vw'+(seen?' on':'')+'" data-vw="'+esc(f.path)+'" title="'+
      (seen?'Mark as not reviewed':'Mark reviewed — collapses until the file changes')+'">'+
      (seen?SVG.boxOn:SVG.box)+' viewed</button>'+
    '<button class="eye" data-hf="'+esc(f.path)+'" title="Hide from diff">'+SVG.eye+' hide</button></div>';
  if(f.binary) return '<div class="'+cls+'" id="f'+fi+'" data-path="'+esc(f.path)+'">'+head+
    '<div class="empty">Binary file — not shown.</div></div>';
  const blocks=[];
  for(let b=0;b<blockCount(f);b++){
    blocks.push('<tbody class="blk" id="b'+fi+'-'+b+'" data-fi="'+fi+'" data-b="'+b+'">'+phHtml(blockH(f,b))+'</tbody>');
  }
  return '<div class="'+cls+'" id="f'+fi+'" data-path="'+esc(f.path)+'">'+head+
    '<table><colgroup><col style="width:22px"><col style="width:46px"><col style="width:46px"><col></colgroup>'+
    blocks.join('')+'</table></div>';
}

/**
 * Mount ahead of the viewport, drop far behind it. The gap between the two margins
 * is the hysteresis that stops blocks thrashing while scrolling.
 */
const obsMount=new IntersectionObserver(
  es=>es.forEach(e=>{ if(e.isIntersecting) mountBlock(e.target); }),
  {root:el('diff'),rootMargin:'1200px 0px'},
);
const obsDrop=new IntersectionObserver(
  es=>es.forEach(e=>{ if(!e.isIntersecting) unmountBlock(e.target); }),
  {root:el('diff'),rootMargin:'3000px 0px'},
);
function observeBlock(tb){ obsMount.observe(tb); obsDrop.observe(tb); }
function unobserveIn(node){
  node.querySelectorAll('tbody.blk').forEach(tb=>{ obsMount.unobserve(tb); obsDrop.unobserve(tb); });
  obsPass.unobserve(node);
}

/* ---------- automatic viewed: a file read at reading speed marks itself off ---------- */
let scrollSpeed=0, scrollDir=0;
(function trackScroll(){
  const sec=el('diff');
  let lastY=sec.scrollTop, lastT=performance.now();
  sec.addEventListener('scroll',()=>{
    const t=performance.now(), y=sec.scrollTop, dt=t-lastT;
    if(dt>=8){
      scrollSpeed=scrollSpeed*0.55+(Math.abs(y-lastY)/dt*1000)*0.45;
      if(y!==lastY) scrollDir=y>lastY?1:-1;
      lastY=y; lastT=t;
    }
    state.scrolled=true;
    if(scrollDir===-1) undoPass();
  },{passive:true});
})();
/** Root shrunk to a zero-height line at the top of the pane: entries fire as a card crosses it. */
const obsPass=new IntersectionObserver(es=>es.forEach(passedTop),{root:el('diff'),rootMargin:'0px 0px -100% 0px'});
function tooFast(){ return state.cfg.limit>0&&scrollSpeed>state.cfg.limit; }
function passedTop(e){
  if(!state.cfg.auto||!state.scrolled) return;
  if(performance.now()<state.jumpUntil||tooFast()) return;
  const p=e.target.dataset.path;
  if(!p) return;
  const line=e.rootBounds?e.rootBounds.top:0;
  const box=e.boundingClientRect;
  if(scrollDir===1&&!e.isIntersecting&&box.bottom<=line+1){
    if(state.viewed.has(p)||state.folded.has(p)) return; // collapsed means its lines were never on screen
    if(setViewed([p],true,true).length){ state.autoNow.add(p); toast(p,true); }
    return;
  }
  if(scrollDir===-1) undoPass();
}
/** Files this session auto-marked that are back on screen, nearest the top line first. */
function undoEligible(){
  const sec=el('diff');
  const line=sec.getBoundingClientRect().top, pane=sec.clientHeight, out=[];
  state.autoNow.forEach(p=>{
    const node=el('f'+idxOf(p));
    if(!node) return;
    const gap=node.getBoundingClientRect().top-line;
    if(gap>=-1&&gap<pane) out.push({p,gap});
  });
  return out.sort((a,b)=>a.gap-b.gap);
}
/** One file per tick, so a re-expansion cascade cannot unwind a whole run at once. */
let undoT=null;
function scheduleUndo(){
  if(undoT) return;
  undoT=setTimeout(()=>{ undoT=null; undoPass(); },260);
}
function undoPass(){
  if(!state.cfg.auto||!state.cfg.back||!state.scrolled) return;
  if(scrollDir!==-1||tooFast()||performance.now()<state.jumpUntil) return;
  const now=performance.now();
  if(now-state.lastUndo<250){ scheduleUndo(); return; }
  const list=undoEligible();
  if(!list.length) return;
  state.lastUndo=now;
  const p=list[0].p;
  state.autoNow.delete(p);
  if(setViewed([p],false).length) toast(p,false);
  if(undoEligible().length) scheduleUndo();
}
function toast(p,on){
  if(!state.cfg.toast) return;
  const host=el('toasts');
  const t=document.createElement('div');
  t.className='toast'+(on?'':' off');
  t.innerHTML='<span class="ic">'+(on?SVG.boxOn:SVG.box)+'</span>'+
    '<span class="tx" title="'+esc(p)+'">'+esc(p.split('/').pop())+'</span>'+
    '<span class="lbl">'+(on?'viewed':'unviewed')+'</span><button class="undo">undo</button>';
  t.querySelector('.undo').onclick=()=>{ setViewed([p],!on); t.remove(); };
  host.append(t);
  while(host.children.length>3) host.firstElementChild.remove();
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),200); },2600);
}

/** True when the element starts above the fold, so resizing it would shove the visible content. */
function anchored(node){
  return node.getBoundingClientRect().top<el('diff').getBoundingClientRect().top;
}
function mountBlock(tb){
  if(tb.dataset.on||!tb.offsetParent) return;
  const fi=Number(tb.dataset.fi), b=Number(tb.dataset.b), f=state.files[fi];
  if(!f) return;
  const from=b*BLOCK, to=blockEnd(f,b);
  const above=anchored(tb);
  const before=tb.offsetHeight;
  const lang=langOf(f.path), wd=wordDiff(f), html=[];
  for(let k=from;k<to;k++) html.push(rowHtml(f.rows[k],fi,k,lang,wd.get(k)));
  tb.innerHTML=html.join('');
  tb.dataset.on='1';
  applyNotesIn(f,fi,from,to);
  const after=tb.offsetHeight;
  state.h.set(f.path+'|'+b,after);
  if(above&&after!==before) el('diff').scrollTop+=after-before;
  if(state.sel&&state.sel.fi===fi) paintSel();
}
function unmountBlock(tb){
  if(!tb.dataset.on||!tb.offsetParent) return; // hidden inside a collapsed file: measuring it would cache 0
  if(tb.querySelector('textarea')) return; // an open editor would lose its text
  const fi=Number(tb.dataset.fi), b=Number(tb.dataset.b), f=state.files[fi];
  if(!f) return;
  state.h.set(f.path+'|'+b,tb.offsetHeight);
  tb.innerHTML=phHtml(tb.offsetHeight);
  delete tb.dataset.on;
}

function insertCard(fi){
  const sec=el('diff');
  if(!sec.querySelector('.file')){ renderDiff(); return; }
  const tmp=document.createElement('div');
  tmp.innerHTML=fileHtml(state.files[fi],fi);
  const node=tmp.firstElementChild;
  let next=null;
  for(let k=fi+1;k<state.files.length&&!next;k++) next=el('f'+k);
  next?sec.insertBefore(node,next):sec.append(node);
  node.querySelectorAll('tbody.blk').forEach(observeBlock);
  obsPass.observe(node);
}
function removeCard(fi){
  const node=el('f'+fi); if(!node) return;
  unobserveIn(node); node.remove();
  if(!el('diff').querySelector('.file')) renderDiff();
}
/** Marking a file viewed collapses it, the way a finished file gets out of the way. */
function setViewed(paths,on,auto){
  const list=[].concat(paths).filter(p=>idxOf(p)>=0&&on!==state.viewed.has(p));
  if(!list.length) return [];
  list.forEach(p=>{
    const fi=idxOf(p);
    if(on){ state.viewed.set(p,{h:state.files[fi].hash,auto:!!auto}); state.folded.add(p); }
    else { state.viewed.delete(p); state.folded.delete(p); }
    if(!auto) state.autoNow.delete(p); // a hand-set mark is no longer the scroll tracker's to undo
    if(state.stale) state.stale.delete(p);
  });
  save();
  if(list.length>20) renderDiff();
  else list.forEach(p=>paintCard(idxOf(p),on));
  renderTree(); updateCount();
  return list;
}
/**
 * Collapsing a card that starts above the fold would yank the page, so absorb the height change.
 * scrollTop is assigned rather than nudged: shrinking the document makes the browser clamp it first,
 * and a relative nudge would then apply the same shrink twice.
 */
function paintCard(fi,on){
  const node=el('f'+fi); if(!node) return;
  const sec=el('diff');
  const paneTop=sec.getBoundingClientRect().top;
  const r0=node.getBoundingClientRect();
  const inside=r0.top<paneTop&&r0.bottom>paneTop;
  const above=r0.bottom<=paneTop;
  const st0=sec.scrollTop;
  const h0=node.offsetHeight;
  node.classList.toggle('seen',on);
  node.classList.toggle('fold',on);
  const chev=node.querySelector('[data-fold]');
  if(chev){ chev.innerHTML=on?SVG.chevR:SVG.chevD; chev.title=on?'Expand file':'Collapse file'; }
  const btn=node.querySelector('[data-vw]');
  if(btn){
    btn.classList.toggle('on',on);
    btn.innerHTML=(on?SVG.boxOn:SVG.box)+' viewed';
    btn.title=on?'Mark as not reviewed':'Mark reviewed — collapses until the file changes';
  }
  const stale=node.querySelector('.stale');
  if(stale) stale.remove();
  // Reading inside it: its sticky header is already at the top of the pane, so leave the header put.
  if(inside) sec.scrollTop=Math.max(0,st0+(r0.top-paneTop));
  else if(above) sec.scrollTop=Math.max(0,st0+(node.offsetHeight-h0));
}
/** Bulk toggles rebuild once; single files patch the DOM in place. */
function setHidden(paths,hide){
  const changed=paths.filter(p=>hide!==state.hidden.has(p));
  if(!changed.length) return;
  changed.forEach(p=>hide?state.hidden.add(p):state.hidden.delete(p));
  if(changed.length>20) renderDiff();
  else changed.forEach(p=>{ const fi=idxOf(p); if(fi>=0) hide?removeCard(fi):insertCard(fi); });
  save(); renderTree(); updateCount();
}

function rowHtml(r,fi,idx,lang,wr){
  const id='r'+fi+'-'+idx;
  if(r.t==='hunk') return '<tr id="'+id+'" class="hunk"><td class="act"></td><td colspan="3">'+esc(r.text)+'</td></tr>';
  return '<tr id="'+id+'" class="r '+r.t+'" data-fi="'+fi+'" data-i="'+idx+'">'+
    '<td class="act"><button class="add" title="Comment on this line">'+SVG.plus+'</button></td>'+
    '<td class="g go">'+(r.o!=null?r.o:'')+'</td>'+
    '<td class="g gn">'+(r.n!=null?r.n:'')+'</td>'+
    '<td class="c">'+codeHtml(r.text,lang,wr)+'</td></tr>';
}

/* ---------- selection ---------- */
let drag=null;
function paintSel(){
  el('diff').querySelectorAll('tr.sel').forEach(tr=>tr.classList.remove('sel'));
  const s=state.sel; if(!s) return;
  const [i,j]=[Math.min(s.a,s.b),Math.max(s.a,s.b)];
  for(let k=i;k<=j;k++){
    const tr=el('r'+s.fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.add('sel');
  }
}
function clearSel(){ state.sel=null; paintSel(); }

const textSelected=()=>{
  const s=window.getSelection&&window.getSelection();
  return !!(s&&!s.isCollapsed&&String(s).trim());
};
el('diff').addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  // Pressing the gutter can only mean row selection; pressing code may still mean "select this text".
  if(e.target.closest('td.act,td.g')){ e.preventDefault(); document.body.classList.add('dragging'); }
  if(e.shiftKey&&state.sel&&state.sel.fi===fi) state.sel.b=i;
  else state.sel={fi,a:i,b:i};
  drag={fi,moved:false};
  paintSel();
});
// Hit-test the pointer: while a text drag is in flight the browser keeps sending events to the press target.
document.addEventListener('mousemove',e=>{
  if(!drag) return;
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const tr=under&&under.closest?under.closest('tr.r'):null;
  if(!tr||Number(tr.dataset.fi)!==drag.fi) return;
  const i=Number(tr.dataset.i);
  if(state.sel.b===i) return;
  state.sel.b=i; drag.moved=true;
  document.body.classList.add('dragging');
  const s=window.getSelection&&window.getSelection();
  if(s&&!s.isCollapsed) s.removeAllRanges();
  paintSel();
});
document.addEventListener('mouseup',()=>{
  if(!drag) return;
  const moved=drag.moved; drag=null;
  document.body.classList.remove('dragging');
  if(moved) openEditor();
});
el('diff').addEventListener('click',e=>{
  const fold=e.target.closest('[data-fold]');
  if(fold){
    const p=fold.dataset.fold;
    toggle(state.folded,p); save();
    const folded=state.folded.has(p), node=el('f'+idxOf(p));
    if(node) node.classList.toggle('fold',folded);
    fold.innerHTML=folded?SVG.chevR:SVG.chevD;
    fold.title=folded?'Expand file':'Collapse file';
    return;
  }
  const vw=e.target.closest('[data-vw]');
  if(vw){ setViewed([vw.dataset.vw],!state.viewed.has(vw.dataset.vw)); return; }
  const hf=e.target.closest('[data-hf]');
  if(hf){ setHidden([hf.dataset.hf],!state.hidden.has(hf.dataset.hf)); return; }
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  if(textSelected()){ clearSel(); return; }
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  if(!state.sel||state.sel.fi!==fi){ state.sel={fi,a:i,b:i}; paintSel(); }
  openEditor();
});

/* ---------- notes ---------- */
function span(f,i,j){
  const rows=f.rows.slice(i,j+1).filter(r=>r.t!=='hunk');
  const ns=rows.filter(r=>r.n!=null).map(r=>r.n);
  const os=rows.filter(r=>r.n==null&&r.o!=null).map(r=>r.o);
  const nums=ns.length?ns:os;
  if(!nums.length) return {side:'new',start:0,end:0,label:'0',code:''};
  const start=Math.min.apply(null,nums), end=Math.max.apply(null,nums);
  const code=rows.map(r=>(r.t==='add'?'+':r.t==='del'?'-':' ')+r.text).join('\n');
  return {side:ns.length?'new':'old',start,end,label:start===end?String(start):start+'-'+end,code};
}
function bounds(){
  const s=state.sel; if(!s) return null;
  const f=state.files[s.fi];
  let i=Math.min(s.a,s.b), j=Math.max(s.a,s.b);
  while(i<=j&&f.rows[i].t==='hunk') i++;
  while(j>=i&&f.rows[j].t==='hunk') j--;
  if(i>j) return null;
  return {f,fi:s.fi,i,j};
}
/** An untouched draft is disposable: a new click or shift-extend should move it, not stack a second box. */
function dropEmptyDraft(){
  const row=state.draftRow;
  state.draftRow=null;
  if(!row||!row.isConnected) return;
  const ta=row.querySelector('textarea');
  if(ta&&!ta.value.trim()) row.remove();
}
function openEditor(){
  const b=bounds(); if(!b) return;
  const {f,fi,i,j}=b;
  const anchor=el('r'+fi+'-'+j); if(!anchor) return;
  const id=noteId(f.path,rowKey(f.rows[i]),rowKey(f.rows[j]));
  const mounted=rowFor(anchor,id);
  if(mounted!==state.draftRow) dropEmptyDraft();
  if(mounted&&mounted.isConnected){
    const ta=mounted.querySelector('textarea');
    if(ta) ta.focus();
    else editUI(mounted.querySelector('.nbox'),{f,fi,i,j,id,body:state.notes.get(id).body});
    return;
  }
  const existing=state.notes.get(id);
  const box=mountRow(anchor,id);
  state.draftRow=box.parentElement.parentElement;
  editUI(box,{f,fi,i,j,id,body:existing?existing.body:''});
}
/** Several ranges can end on the same row, so each note row is tagged and matched by id. */
function rowFor(anchor,id){
  let n=anchor.nextElementSibling;
  while(n&&n.classList.contains('nrow')){
    if(n.dataset.nid===id) return n;
    n=n.nextElementSibling;
  }
  return null;
}
function mountRow(anchor,id){
  let after=anchor;
  while(after.nextElementSibling&&after.nextElementSibling.classList.contains('nrow')) after=after.nextElementSibling;
  const row=document.createElement('tr'); row.className='nrow'; row.dataset.nid=id;
  const td=document.createElement('td'); td.colSpan=4;
  const box=document.createElement('div'); box.className='nbox';
  td.append(box); row.append(td); after.after(row);
  return box;
}
function headHtml(f,label,extra){
  return '<div class="nhead"><span class="loc">'+esc(f.path)+':'+label+'</span><span class="spacer"></span>'+(extra||'')+'</div>';
}
function editUI(box,ctx){
  const {f,fi,i,j,id}=ctx;
  const sp=span(f,i,j);
  box.innerHTML=headHtml(f,sp.label)+'<div class="nedit"><textarea placeholder="What should change here?"></textarea>'+
    '<div class="acts"><button class="primary">Save note</button><button class="cancel">Cancel</button>'+
    '<span class="spacer"></span><span class="tip">cmd/ctrl+enter save &middot; esc cancel</span></div></div>';
  const ta=box.querySelector('textarea');
  ta.value=ctx.body||'';
  ta.focus();
  const commit=()=>{
    const body=ta.value.trim();
    if(!body){ drop(); return; }
    const note={id,file:f.path,body,a:rowKey(f.rows[i]),b:rowKey(f.rows[j]),
      side:sp.side,start:sp.start,end:sp.end,label:sp.label,code:sp.code};
    state.notes.set(id,note);
    save(); clearSel();
    viewUI(box,note,{f,fi,i,j});
    mark(fi,i,j,true);
    renderTree(); updateCount();
  };
  const drop=()=>{
    if(state.notes.has(id)){ state.notes.delete(id); save(); mark(fi,i,j,false); renderTree(); updateCount(); }
    box.parentElement.parentElement.remove(); clearSel();
  };
  box.querySelector('.primary').onclick=commit;
  box.querySelector('.cancel').onclick=()=>{
    const kept=state.notes.get(id);
    clearSel();
    if(kept) viewUI(box,kept,{f,fi,i,j});
    else box.parentElement.parentElement.remove();
  };
  ta.onkeydown=e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); commit(); }
    if(e.key==='Escape'){ e.preventDefault(); box.querySelector('.cancel').click(); }
  };
}
function viewUI(box,note,ctx){
  box.innerHTML=headHtml(ctx.f,note.label,'<button class="edit">Edit</button><button class="danger del">Delete</button>')+
    '<div class="nbody"></div>';
  box.querySelector('.nbody').textContent=note.body;
  box.querySelector('.edit').onclick=()=>editUI(box,Object.assign({},ctx,{id:note.id,body:note.body}));
  box.querySelector('.del').onclick=()=>{
    state.notes.delete(note.id); save();
    mark(ctx.fi,ctx.i,ctx.j,false);
    box.parentElement.parentElement.remove();
    renderTree(); updateCount();
  };
}
function mark(fi,i,j,on){
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',on);
  }
}
function keyIndex(f){
  if(!f.ki){
    const m=new Map();
    f.rows.forEach((r,i)=>{ if(r.t!=='hunk') m.set(rowKey(r),i); });
    f.ki=m;
  }
  return f.ki;
}
function applyNotesIn(f,fi,from,to){
  const ki=keyIndex(f);
  state.notes.forEach(n=>{
    if(n.file!==f.path) return;
    const i=ki.has(n.a)?ki.get(n.a):-1, j=ki.has(n.b)?ki.get(n.b):-1;
    if(i<0||j<0||j<i||j<from||i>=to) return;
    mark(fi,Math.max(i,from),Math.min(j,to-1),true);
    if(j<from||j>=to) return; // the box belongs to the block holding the last row
    const anchor=el('r'+fi+'-'+j); if(!anchor) return;
    const id=n.id||noteId(n.file,n.a,n.b);
    if(!rowFor(anchor,id)) viewUI(mountRow(anchor,id),n,{f,fi,i,j});
  });
}

/* ---------- tree interactions ---------- */
function toggle(set,key){ set.has(key)?set.delete(key):set.add(key); }
el('tree').addEventListener('click',e=>{
  const vd=e.target.closest('[data-vd]');
  if(vd){
    const node=findDir(dirTree(),vd.dataset.vd);
    const kids=node?filesUnder(node):[];
    setViewed(kids,!(kids.length>0&&kids.every(p=>state.viewed.has(p))));
    return;
  }
  const vf=e.target.closest('[data-vf]');
  if(vf){ setViewed([vf.dataset.vf],!state.viewed.has(vf.dataset.vf)); return; }
  const hd=e.target.closest('[data-hd]');
  if(hd){
    const node=findDir(dirTree(),hd.dataset.hd);
    const kids=node?filesUnder(node):[];
    setHidden(kids,!(kids.length>0&&kids.every(p=>state.hidden.has(p))));
    return;
  }
  const hf=e.target.closest('[data-hf]');
  if(hf){ setHidden([hf.dataset.hf],!state.hidden.has(hf.dataset.hf)); return; }
  const dir=e.target.closest('[data-dir]');
  if(dir){ toggle(state.collapsed,dir.dataset.dir); save(); renderTree(); return; }
  const file=e.target.closest('[data-file]');
  if(file){
    const p=file.dataset.file;
    if(state.hidden.has(p)) setHidden([p],false);
    const target=el('f'+file.dataset.idx);
    if(target){
      state.jumpUntil=performance.now()+500; // a jump is not "scrolling past" anything
      target.scrollIntoView({block:'start'});
    }
    el('tree').querySelectorAll('.tw.sel').forEach(x=>x.classList.remove('sel'));
    file.classList.add('sel');
  }
});
function findDir(node,p){
  let found=null;
  const walk=n=>n.children.forEach(c=>{ if(!c.dir) return; if(c.path===p) found=c; else walk(c); });
  walk(node);
  return found;
}
document.querySelector('.navbtns').addEventListener('click',e=>{
  const b=e.target.closest('[data-all]'); if(!b) return;
  if(b.dataset.all==='collapse'){
    const all=[];
    const walk=n=>n.children.forEach(c=>{ if(c.dir){ all.push(c.path); walk(c); } });
    walk(dirTree());
    state.collapsed=new Set(all); save(); renderTree(); return;
  }
  if(b.dataset.all==='expand'){ state.collapsed=new Set(); save(); renderTree(); return; }
  setHidden(state.files.map(f=>f.path),b.dataset.all==='hide');
});
el('filter').oninput=e=>{ state.filter=e.target.value.trim().toLowerCase(); renderTree(); };

/* ---------- settings ---------- */
el('gear').innerHTML=SVG.sliders;
el('gear').onclick=e=>{
  e.stopPropagation();
  const s=el('settings');
  s.hidden=!s.hidden;
  el('gear').classList.toggle('on',!s.hidden);
};
el('settings').addEventListener('click',e=>e.stopPropagation());
el('settings').addEventListener('change',saveCfg);
document.addEventListener('click',()=>{
  if(el('settings').hidden) return;
  el('settings').hidden=true; el('gear').classList.remove('on');
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!el('settings').hidden){ el('settings').hidden=true; el('gear').classList.remove('on'); }
});

/** Cached block heights assume the current wrap width, so a resize invalidates them. */
let resizeT=null;
window.addEventListener('resize',()=>{
  clearTimeout(resizeT);
  resizeT=setTimeout(()=>{ state.h.clear(); renderDiff(); },250);
});

/* ---------- footer ---------- */
function updateCount(){
  const n=state.notes.size, hid=state.hidden.size, seen=state.viewed.size;
  el('count').textContent=n+(n===1?' note':' notes')+
    (state.files.length?' · '+seen+'/'+state.files.length+' viewed':'')+
    (hid?' · '+hid+' hidden':'');
}
el('general').oninput=save;
el('reload').onclick=()=>load();
el('submit').onclick=async()=>{
  const general=el('general').value;
  if(!state.notes.size&&!general.trim()){ alert('Add at least one note before saving.'); return; }
  const r=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({general,comments:[...state.notes.values()]})});
  const d=await r.json();
  if(!r.ok){ alert('Could not save: '+(d.error||r.status)); return; }
  document.body.innerHTML='<div class="done"><p>Saved <code>'+d.file+'</code> — '+d.count+' notes.</p>'+
    '<p>Hand it to the agent:</p><p><code>Address the notes in '+d.file+'</code></p>'+
    '<p style="color:var(--ink-faint)">Server still running. Reload this page to review again.</p></div>';
};
loadCfg();
load();
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (req.url === '/api/diff') {
      const files = await getDiff();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ range: rangeLabel, files }));
    }
    if (req.url === '/api/submit' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { general = '', comments = [] } = JSON.parse(Buffer.concat(chunks).toString());
      const md = renderMarkdown({ general, comments, range: rangeLabel });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `review-${stamp}.md`);
      await writeFile(file, md, 'utf8');
      console.log(`\n  saved ${file}  (${comments.length} notes)`);
      console.log(`  next: ask the agent to "address the notes in ${file}"\n`);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ file, count: comments.length }));
    }
    res.writeHead(404).end('not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(port, () => {
  console.log(`\n  git review  ->  http://localhost:${port}`);
  console.log(`  diff: ${rangeLabel}`);
  console.log(`  repo: ${repoRoot}`);
  console.log(`  out:  ${outDir}/\n`);
});
