import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { submitNote, submitReview, withdrawNotes } from "./persistence.ts";
import { state } from "./state.ts";
import { adoptAgent, noteSaveLabel } from "./agent.ts";

const originalFetch=globalThis.fetch;
const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,"document");
const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
const saved={notes:state.notes,noteSending:state.noteSending,noteDelivery:state.noteDelivery,
  sessionFile:state.sessionFile,agent:state.agent,connection:state.connection,soloKeys:state.soloKeys};
const file=".review/review-2026-10-28T12-00-00.md";
const first={id:"a.ts|n1|n1|#first",file:"a.ts",body:"Why?",start:1,end:1,label:"1"};
const second={...first,id:"a.ts|n2|n2|#second",start:2,end:2,label:"2",body:"Keep this draft local."};

beforeEach(()=>{
  state.notes=new Map([[first.id,{...first}],[second.id,{...second}]]);
  state.noteSending=new Map(); state.noteDelivery=new Map(); state.soloKeys=new Set();
  state.sessionFile=""; state.agent="Claude"; state.connection=null;
  Object.defineProperty(globalThis,"document",{configurable:true,value:{getElementById:()=>null,querySelectorAll:()=>[]}});
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{setItem:()=>{}}});
});
afterEach(()=>{
  globalThis.fetch=originalFetch;
  Object.assign(state,saved);
  if(documentDescriptor) Object.defineProperty(globalThis,"document",documentDescriptor); else delete (globalThis as any).document;
  if(storageDescriptor) Object.defineProperty(globalThis,"localStorage",storageDescriptor); else delete (globalThis as any).localStorage;
});

describe("individual note sending",()=>{
  test("posts only the saved note and stamps no other local note as submitted",async()=>{
    let posted:any;
    globalThis.fetch=(async(url,init)=>{
      expect(url).toBe("/api/note"); posted=JSON.parse(init!.body as string);
      return Response.json({file,id:first.id,connection:{agent:"claude",state:"ready",detail:"Confirmed"},channel:{state:"forwarded",count:1}});
    }) as any;
    await submitNote(state.notes.get(first.id));
    expect(posted.comment.id).toBe(first.id);
    expect(posted.comments).toBeUndefined();
    expect(state.notes.get(first.id).sentAt).toBeGreaterThan(0);
    expect(state.notes.get(second.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("a deletion waits for a pending save and does not restore the deleted browser note",async()=>{
    let release:(response:Response)=>void=()=>{};
    let began:()=>void=()=>{};
    const started=new Promise<void>((resolve)=>{began=resolve;});
    const methods:string[]=[];
    globalThis.fetch=(async(_url,init)=>{
      methods.push(init!.method!);
      if(init!.method==="POST"){ began(); return new Promise<Response>((resolve)=>{release=resolve;}); }
      return Response.json({removed:true});
    }) as any;
    const sending=submitNote(state.notes.get(first.id));
    await started;
    state.notes.delete(first.id);
    const removing=withdrawNotes([first.id]);
    expect(methods).toEqual(["POST"]);
    release(Response.json({file,id:first.id}));
    await Promise.all([sending,removing]);
    expect(methods).toEqual(["POST","DELETE"]);
    expect(state.notes.has(first.id)).toBe(false);
  });

  test("a failed write leaves the text intact and clears the pending marker",async()=>{
    globalThis.fetch=(async()=>Response.json({error:"Disk full"},{status:500})) as any;
    await expect(submitNote(state.notes.get(first.id))).rejects.toThrow("Disk full");
    expect(state.notes.get(first.id).body).toBe("Why?");
    expect(state.notes.get(first.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("the note button follows confirmed agent status, including an already open editor",()=>{
    const button={disabled:false,textContent:""};
    const status={textContent:"",title:""};
    (globalThis as any).document.querySelectorAll=()=>[button];
    (globalThis as any).document.getElementById=()=>status;
    adoptAgent({connection:{agent:"claude",state:"checking",detail:"Waiting for confirmation"}});
    expect(noteSaveLabel()).toBe("Save note");
    expect(button.textContent).toBe("Save note");
    adoptAgent({connection:{agent:"claude",state:"ready",detail:"Confirmed"}});
    expect(button.textContent).toBe("Save & ask AI");
    adoptAgent({connection:{agent:"codex",state:"ready",detail:"Session found"}});
    expect(button.textContent).toBe("Save & ask AI");
    adoptAgent({connection:{agent:"claude",state:"unavailable",detail:"No confirmation; policy may block it"}});
    expect(button.textContent).toBe("Save note");
    expect(status.textContent).toBe("Claude unavailable");
  });
});

describe("whole review saving",()=>{
  test("queues behind single-note saves and before deletion, stamping only submitted notes",async()=>{
    let release:(response:Response)=>void=()=>{};
    let began:()=>void=()=>{};
    const started=new Promise<void>((resolve)=>{began=resolve;});
    const requests:any[]=[];
    globalThis.fetch=(async(url,init)=>{
      requests.push({url,body:init!.body?JSON.parse(init!.body as string):null});
      if(url==="/api/note"){ began(); return new Promise<Response>((resolve)=>{release=resolve;}); }
      return Response.json({file});
    }) as any;
    const sending=submitNote(state.notes.get(first.id));
    await started;
    const saving=submitReview();
    // A later edit must not alter the snapshot already requested for this save.
    state.notes.get(second.id).body="Changed while waiting";
    const later={...first,id:"a.ts|n3|n3|#later"};
    state.notes.set(later.id,later);
    state.notes.delete(first.id);
    const deleting=withdrawNotes([first.id]);
    expect(requests).toHaveLength(1);
    expect(state.noteSending.has(second.id)).toBe(true);
    release(Response.json({file}));
    await Promise.all([sending,saving,deleting]);
    expect(requests.map(r=>r.url.split('?')[0])).toEqual(["/api/note","/api/submit","/api/note"]);
    expect(requests[1].body.comments).toEqual([second]);
    expect(state.notes.get(first.id)).toBeUndefined();
    expect(state.notes.get(second.id).sentAt).toBeGreaterThan(0);
    expect(state.notes.get(later.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
  });

  test("reports failed saves without stamping or losing local notes",async()=>{
    globalThis.fetch=(async()=>Response.json({error:"Disk full"},{status:500})) as any;
    await expect(submitReview()).rejects.toThrow("Disk full");
    expect(state.notes.get(first.id).body).toBe(first.body);
    expect(state.notes.get(first.id).sentAt).toBeUndefined();
    expect(state.noteSending.size).toBe(0);
    globalThis.fetch=(async()=>{throw new Error("Offline");}) as any;
    await expect(submitReview()).rejects.toThrow("Offline");
    expect(state.noteSending.size).toBe(0);
  });
});
