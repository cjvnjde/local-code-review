import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { probeCodex } from "./codex-status.ts";
import { runGit } from "./git.ts";

async function fixture(overrides: Record<string, unknown> = {}) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),"lcr-codex-status-")));
  const config={queue:true,threads:[{id:"id-1",name:"review",cwd:root}],...overrides};
  const script=path.join(root,"fake.ts");
  await writeFile(script,`import {createInterface} from 'node:readline';
const config=${JSON.stringify(config)};
if(process.argv[2]==='queue') process.exit(config.queue?0:2);
for await(const line of createInterface({input:process.stdin})){
  const p=JSON.parse(line); if(p.id==null) continue;
  let result={},error;
  if(p.method==='thread/read'){
    const thread=config.threads.find(t=>t.id===p.params.threadId);
    if(thread) result={thread}; else error={message:'Not found'};
  }
  if(p.method==='thread/list') result={data:config.threads,nextCursor:null};
  process.stdout.write(JSON.stringify({id:p.id,result,error})+'\\n');
}
`);
  const calls:string[][]=[];
  const spawn=((args:string[],options:any)=>{
    calls.push(args);
    return Bun.spawn([process.execPath,script,...args.slice(1)],options);
  }) as typeof Bun.spawn;
  return {root,config,calls,spawn};
}

describe("passive Codex session checks",()=>{
  test("checks queue support and session metadata without starting a turn",async()=>{
    const f=await fixture();
    expect(await probeCodex("id-1",f.root,f.spawn)).toEqual({ok:true,thread:"id-1"});
    expect(f.calls).toEqual([["codex","queue","--help"],["codex","app-server","proxy"]]);
  });
  test("resolves a unique exact session name",async()=>{
    const f=await fixture();
    expect(await probeCodex("review",f.root,f.spawn)).toEqual({ok:true,thread:"id-1"});
  });
  test("rejects missing and ambiguous names",async()=>{
    const f=await fixture();
    expect((await probeCodex("missing",f.root,f.spawn)).ok).toBe(false);
    const ambiguous=await fixture({threads:[{id:"a",name:"review",cwd:f.root},{id:"b",name:"review",cwd:f.root}]});
    expect((await probeCodex("review",ambiguous.root,ambiguous.spawn)).error).toContain("ambiguous");
  });
  test("does not offer a session from another repository",async()=>{
    const f=await fixture({threads:[{id:"id-1",name:"review",cwd:"/"}]});
    expect((await probeCodex("id-1",f.root,f.spawn)).error).toContain("different repository");
  });
  test("accepts a session started in a subdirectory of the same repository",async()=>{
    const f=await fixture();
    await runGit(["init","-q"],f.root);
    const sub=path.join(f.root,"src"); await mkdir(sub);
    f.config.threads[0]!.cwd=sub;
    const script=path.join(f.root,"fake.ts");
    const text=await Bun.file(script).text();
    await writeFile(script,text.replace(JSON.stringify(f.root),JSON.stringify(sub)));
    expect((await probeCodex("id-1",f.root,f.spawn)).ok).toBe(true);
  });
  test("reports an installed CLI without queue support as unavailable",async()=>{
    const f=await fixture({queue:false});
    expect((await probeCodex("id-1",f.root,f.spawn)).error).toContain("does not support");
    expect(f.calls).toHaveLength(1);
  });
});
