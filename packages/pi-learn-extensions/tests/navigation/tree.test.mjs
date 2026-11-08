// Installed Pi TUI + explicit synthetic entries only. Never open private session files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
const bin=realpathSync(process.env.PI_TEST_BIN ?? execFileSync("which",["pi"],{encoding:"utf8"}).trim());
const require=createRequire(bin),tuiUrl=pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;
const hook=registerHooks({resolve(s,c,next){return s==="@earendil-works/pi-tui"?{url:tuiUrl,shortCircuit:true}:next(s,c);}});
const {SessionTreeView:HistoryDemo}=await import("../../extensions/aurora/tree-view.ts");
const {sessionEvents,eventRows,eventId:E,sampleEvents,groupThinking,latestUserOnPath,userSections}=await import("../../extensions/aurora/tree-events.ts");
const {default:treeDemo}=await import("../../extensions/aurora/tree-command.ts");
const {matchesKey,stripTerminalSequences:plain,visibleWidth}=await import(tuiUrl);
const themeUrl=new URL("../modes/interactive/theme/theme.js",pathToFileURL(bin));
const {loadThemeFromPath}=await import(themeUrl.href);
const themeFor=appearance=>loadThemeFromPath(fileURLToPath(new URL(`${appearance}.json`,themeUrl)));
hook.deregister();
const keys={"tui.select.up":"up","tui.select.down":"down","tui.select.confirm":"enter","tui.select.cancel":"escape"};
const kb={matches:(data,action)=>matchesKey(data,keys[action])};
const key={up:"\x1b[A",down:"\x1b[B",left:"\x1b[D",right:"\x1b[C",home:"\x1b[H",end:"\x1b[F",pageDown:"\x1b[6~"};
const stamp="2026-01-01T12:34:00Z";
const msg=(id,parentId,role,content,extra={})=>({type:"message",id,parentId,timestamp:stamp,message:{role,content:typeof content==="string"?[{type:"text",text:content}]:content,stopReason:"stop",...extra}});
function entriesFixture(){return [
  {type:"model_change",id:"model",parentId:null,timestamp:stamp,modelId:"synthetic-model",provider:"synthetic"},
  msg("sys","model","system","PRIVATE_SYSTEM_PROMPT"),
  msg("u1","sys","user","FIRST_QUESTION"),
  msg("a1","u1","assistant",[
    {type:"thinking",thinking:"STORED_THINKING_ONE",thinkingSignature:"PRIVATE_SIGNATURE"},
    {type:"text",text:"INTRODUCTION_ONE"},
    {type:"toolCall",id:"t1",name:"read",arguments:{path:"file.ts",token:"PRIVATE_UNUSED_ARGUMENT"}},
    {type:"toolCall",id:"t2",name:"bash",arguments:{command:"npm test"}},
    {type:"text",text:"AFTER_CALL_TEXT"},
  ]),
  msg("r1","a1","toolResult","PRIVATE_OK_RESULT_BODY",{toolCallId:"t1",toolName:"read",isError:false}),
  msg("r2","r1","toolResult","PRIVATE_FAIL_RESULT_BODY",{toolCallId:"t2",toolName:"bash",isError:true}),
  msg("f1","r2","assistant",[{type:"thinking",thinking:"STORED_THINKING_FINAL"},{type:"text",text:"FINAL_ANSWER_ONE"}]),
  msg("u2","f1","user","SECOND_QUESTION"),msg("a2","u2","assistant","SECOND_ANSWER"),
  msg("ux","f1","user","ALTERNATE_QUESTION"),msg("ax","ux","assistant","ALTERNATE_ANSWER"),
];}
function fixture(appearance="dark",height=28){
  let closed=0,paints=0;
  const source=entriesFixture(),before=JSON.stringify(source),snapshot=sessionEvents(source,"a2");
  const view=new HistoryDemo(snapshot.nodes,themeFor(appearance),kb,()=>height,()=>paints++,()=>closed++,{live:true,currentId:snapshot.currentId});
  view.focused=true;
  return {view,source,before,snapshot,render:(width=120)=>view.render(width).map(plain).join("\n"),get closed(){return closed;},get paints(){return paints;},resize:n=>height=n};
}
const node=(snapshot,id,index=0)=>snapshot.nodes.find(n=>n.id===E(id,index));
const select=(f,id,index=0)=>{const target=E(id,index),group=f.view.groupFor.get(target);if(group)f.view.expandedGroups.add(group);f.view.selectedId=target;f.view.anchor="top";f.view.refresh();};
const openUser=(f,id)=>{select(f,id);f.view.handleInput("\r");assert(f.view.expandedUsers.has(E(id)));};
const content=(f,id,index=0)=>f.view.documentLines.filter(line=>line.id===E(id,index)&&line.hit.kind==="content").map(line=>line.text).join("\n");
const mouse=(x,y,type="click",extra={})=>({type,button:"left",x,y,screenX:x,screenY:y,width:120,height:80,shift:false,ctrl:false,alt:false,...extra});

test("each user/assistant/thinking/tool block is separate and stays in recorded order",()=>{
  const snapshot=sessionEvents(entriesFixture(),"a2");
  assert.deepEqual(snapshot.nodes.filter(n=>n.entryId==="a1").map(n=>n.kind),["thinking","assistant","tool_call","tool_call","assistant"]);
  assert.equal(snapshot.nodes.filter(n=>n.kind==="user").length,3);
  assert.equal(snapshot.nodes.filter(n=>n.kind==="thinking").length,2);
  assert.equal(node(snapshot,"a1",1).body,"INTRODUCTION_ONE");
  assert.equal(node(snapshot,"a1",4).body,"AFTER_CALL_TEXT");
  assert.equal(node(snapshot,"f1",1).body,"FINAL_ANSWER_ONE");
  assert(!node(snapshot,"u1").body.includes("FINAL_ANSWER_ONE"));
});
test("raw parent branches attach to the last part of the actual parent, not to a grouped user turn",()=>{
  const s=sessionEvents(entriesFixture(),"a2");
  assert.equal(node(s,"a1").parentId,E("u1"));
  assert.equal(node(s,"a1",2).parentId,E("a1",1));
  assert.equal(node(s,"r1").parentId,E("a1",4));
  assert.equal(node(s,"r2").parentId,E("r1"));
  assert.equal(node(s,"u2").parentId,E("f1",1));
  assert.equal(node(s,"ux").parentId,E("f1",1));
});
test("current position is mapped from the supplied leaf, not the newest stored branch",()=>{
  const s=sessionEvents(entriesFixture(),"f1");
  assert.equal(s.currentId,E("f1",1));
  assert.notEqual(s.currentId,s.nodes.at(-1).id);
  assert.equal(sessionEvents(entriesFixture(),null).currentId,null);
  assert.equal(sessionEvents(entriesFixture(),"not-found").currentId,null);
});
test("every raw entry has at least one position and source entries stay untouched",()=>{
  const entries=entriesFixture(),before=JSON.stringify(entries),s=sessionEvents(entries,"a2");
  for(const entry of entries)assert(s.nodes.some(n=>n.entryId===entry.id));
  assert.equal(new Set(s.nodes.map(n=>n.id)).size,s.nodes.length);
  assert.equal(JSON.stringify(entries),before);
});
test("tool calls and tool results are distinct title-only events; result bodies never enter the projection",()=>{
  const s=sessionEvents(entriesFixture(),"a2");
  assert.equal(node(s,"a1",2).title,"tool call: read file.ts");
  assert.equal(node(s,"r1").title,"tool: read file.ts");
  assert.equal(node(s,"r2").title,"tool: bash npm test");
  for(const n of s.nodes.filter(n=>n.kind==="tool_call"||n.kind==="tool_result"))assert.equal(n.body,undefined);
  assert(!JSON.stringify(s).includes("PRIVATE_OK_RESULT_BODY"));
  assert(!JSON.stringify(s).includes("PRIVATE_FAIL_RESULT_BODY"));
  assert.equal(node(s,"r2").error,true);
});
test("provider thinking is displayed only if stored; redacted/signature content is not reconstructed",()=>{
  const s=sessionEvents([
    msg("plain",null,"assistant","Plain text"),
    msg("hidden","plain","assistant",[{type:"thinking",redacted:true,thinking:"PRIVATE_REDACTED",thinkingSignature:"PRIVATE_SIGNATURE"}]),
    msg("blank","hidden","assistant",[{type:"thinking",thinkingSignature:"PRIVATE_SIGNATURE"}]),
  ],"blank");
  assert.equal(s.nodes.filter(n=>n.kind==="thinking").length,2);
  assert(!JSON.stringify(s).includes("PRIVATE_"));
  assert.equal(node(s,"blank").body,undefined);
  assert.equal(node(s,"plain").kind,"assistant");
});
test("system/custom state/hidden extension messages have headers without secret-bearing payloads",()=>{
  const s=sessionEvents([
    msg("sys",null,"system","PRIVATE_SYSTEM"),
    {type:"custom",id:"state",parentId:"sys",timestamp:stamp,customType:"test",data:{token:"PRIVATE_STATE"}},
    {type:"custom_message",id:"hidden",parentId:"state",timestamp:stamp,customType:"test",display:false,content:"PRIVATE_CUSTOM"},
    {type:"context_edit",id:"edit",parentId:"hidden",timestamp:stamp,targetId:"sys",replacement:{content:"PRIVATE_EDIT"}},
  ],"edit");
  assert.equal(s.nodes.length,4);
  assert(!JSON.stringify(s).includes("PRIVATE_"));
});
test("tool result lookup is branch-local even when sibling branches reuse a call ID",()=>{
  const s=sessionEvents([
    msg("u",null,"user","Question"),
    msg("left","u","assistant",[{type:"toolCall",id:"same",name:"read",arguments:{path:"left.ts"}}]),
    msg("right","u","assistant",[{type:"toolCall",id:"same",name:"read",arguments:{path:"right.ts"}}]),
    msg("rl","left","toolResult","PRIVATE_LEFT",{toolCallId:"same",toolName:"read"}),
    msg("rr","right","toolResult","PRIVATE_RIGHT",{toolCallId:"same",toolName:"read"}),
  ],"rl");
  assert.equal(node(s,"rl").title,"tool: read left.ts");
  assert.equal(node(s,"rr").title,"tool: read right.ts");
});
test("aborted/empty assistant and direct bash execution still have their own rows",()=>{
  const s=sessionEvents([
    msg("u",null,"user",[{type:"image",data:"PRIVATE_IMAGE"}]),
    msg("a","u","assistant",[],{stopReason:"aborted"}),
    msg("b","a","bashExecution",undefined,{command:"echo hello",output:"PRIVATE_BASH_OUTPUT"}),
  ],"b");
  assert(node(s,"u").title.includes("Ảnh đính kèm"));
  assert.equal(node(s,"a").title,"assistant: (aborted)");
  assert.equal(node(s,"b").title,"bash: echo hello");
  assert(!JSON.stringify(s).includes("PRIVATE_"));
});
test("projection resolves parents independently of input ordering and handles multiple roots",()=>{
  const s=sessionEvents([msg("child","parent","user","Child"),msg("parent",null,"assistant","Parent"),msg("root",null,"user","Root two")],"child");
  assert.equal(node(s,"child").parentId,E("parent"));
  const rows=eventRows(s.nodes,"",new Set());
  assert.equal(rows.length,3);assert.equal(rows[0].node.id,E("parent"));
});
test("event rows indent real branch splits, not every linear event",()=>{
  const s=sessionEvents(entriesFixture(),"a2"),rows=eventRows(s.nodes,"",new Set());
  assert.equal(rows.find(r=>r.node.id===E("a1",2)).prefix,"");
  assert.equal(rows.find(r=>r.node.id===E("u2")).prefix,"├─ ");
  assert.equal(rows.find(r=>r.node.id===E("ux")).prefix,"└─ ");
});
test("search keeps ancestors and temporarily opens folds without including tool output",()=>{
  const s=sessionEvents(entriesFixture(),"a2"),collapsed=new Set([E("u1")]);
  const rows=eventRows(s.nodes,"ALTERNATE_ANSWER",collapsed);
  assert(rows.some(r=>r.node.id===E("ax")));assert(rows.find(r=>r.node.id===E("u1")).ancestor);
  assert.equal(eventRows(s.nodes,"PRIVATE_OK_RESULT_BODY",collapsed).length,0);
  assert(!eventRows(s.nodes,"",collapsed).some(r=>r.node.id===E("a1")));
});
test("deep linear sessions render iteratively without recursive stack overflow",()=>{
  const entries=Array.from({length:2500},(_,i)=>msg(String(i),i?String(i-1):null,i%2?"assistant":"user",`Message ${i}`));
  const s=sessionEvents(entries,"2499");assert.equal(eventRows(s.nodes,"",new Set()).length,2500);
});
test("sample mode creates explicitly synthetic thinking and preserves real entry shapes",()=>{
  const f=sampleEvents(),s=sessionEvents(f.entries,f.leafId);
  assert(s.nodes.some(n=>n.kind==="thinking"&&n.body.includes("minh họa")));
  assert(s.nodes.some(n=>n.kind==="tool_result"));assert(s.currentId);
});

for(const appearance of ["dark","light"])for(const width of [1,31,32,48,80,95,96,120,200])test(`event view fits ${width} columns / ${appearance}`,()=>{
  const f=fixture(appearance);for(const line of f.view.render(width))assert(visibleWidth(line)<=width);
  if(width>=32){assert.equal(f.view.render(width).length,28);assert(f.view.render(width).every(line=>/\x1b\[48;/.test(line)));}
});

test("view exposes separate user/assistant/thinking/tool events with no turn bundle or timestamps",()=>{
  const f=fixture("dark",80);openUser(f,"u1");openUser(f,"ux");const screen=f.render();
  for(const label of ["user:","assistant:","thinking","tool call:","tool:"])assert(screen.includes(label));
  assert.equal(f.view.rows.length,f.snapshot.nodes.length-2,"only pre-user model/system headers are hidden");
  assert.equal(f.view.rows.filter(r=>r.node.kind==="thinking_group").length,2);
  assert(!f.view.rows.some(r=>r.node.kind==="thinking"));
  assert(!screen.includes("12:34"));assert(!/\d+ lỗi|\d+ thao tác|Bạn đã hỏi|Pi đã trả lời/.test(screen));
  assert.equal(JSON.stringify(f.source),f.before);
});
test("opening an old user reveals separate events, not a combined question/answer body",()=>{
  const f=fixture();openUser(f,"u1");f.render();
  assert(f.view.documentLines.some(l=>l.header&&l.id===E("u1")&&l.text.includes("user: FIRST_QUESTION")));
  assert.equal(content(f,"u1"),"","don't duplicate a short question already complete in the header");
  assert(f.view.rows.some(r=>r.node.id===E("a1",1)));
  assert.equal(content(f,"a1",1),"");
  select(f,"a1",1);f.view.handleInput("\r");f.render();
  assert.equal(content(f,"a1",1).trim(),"INTRODUCTION_ONE");
  assert(!content(f,"a1",1).includes("AFTER_CALL_TEXT"));
});
test("thinking can be selected and read separately from the response",()=>{
  const f=fixture();openUser(f,"u1");select(f,"a1");f.view.handleInput("\r");f.render();
  assert(f.view.expandedIds.has(E("a1")));
  assert(content(f,"a1").includes("STORED_THINKING_ONE"));
  assert(!content(f,"a1").includes("INTRODUCTION_ONE"));
  f.view.handleInput("\r");assert(!f.view.expandedIds.has(E("a1")));
});
test("Enter/click on tool call and tool result headers never opens result text",()=>{
  const f=fixture("dark",80);openUser(f,"u1");f.render();const before=f.view.documentLines.length;
  for(const [id,part]of [["a1",2],["r1",0],["r2",0]]){
    select(f,id,part);f.view.handleInput("\r");f.render();
    const [y]=[...f.view.hits].find(([,hit])=>hit.id===E(id,part)&&hit.kind==="node");
    const hit=f.view.hits.get(y);f.view.handleMouse(mouse((hit.fold?.[1]??3)+1,y));f.render();
    assert.deepEqual([...f.view.expandedIds],[E("u2"),E("a2"),E("u1")]);assert.equal(f.view.documentLines.length,before);
  }
  assert(!f.view.documentLines.some(l=>/PRIVATE_.*RESULT_BODY|Hoàn tất|Không đạt/.test(l.text)));
});
test("arrow navigation visits each content block in order and current marker stays at the real leaf",()=>{
  const f=fixture();openUser(f,"u1");select(f,"a1");f.view.handleInput(key.down);assert.equal(f.view.selectedId,E("a1",1));
  f.view.handleInput(key.down);assert.equal(f.view.selectedId,E("a1",2));
  f.view.handleInput(key.down);assert.equal(f.view.selectedId,E("a1",3));
  assert.equal(f.view.currentId,E("a2"));
});
test("left/right fold complete event subtrees and retain the exact current position",()=>{
  const f=fixture();openUser(f,"u1");select(f,"f1",1);f.view.handleInput(key.left);
  assert(!f.view.rows.some(r=>r.node.id===E("u2")));assert(!f.view.rows.some(r=>r.node.id===E("ux")));
  f.view.handleInput(key.right);assert(f.view.rows.some(r=>r.node.id===E("ux")));
  f.view.handleInput(key.right);assert.equal(f.view.selectedId,E("u2"));
  f.view.handleInput(key.left);f.view.handleInput(key.left);assert.equal(f.view.selectedId,E("f1",1));
  assert.equal(f.view.currentId,E("a2"));
});
test("search supports IME focus, empty results, stored thinking and one-Enter reading",()=>{
  const f=fixture();f.view.handleInput("/");for(const c of "NO_MATCH_999")f.view.handleInput(c);
  assert(f.render().includes("Không tìm thấy mục nào"));assert(f.view.search.focused);
  f.view.focused=false;assert(!f.view.search.focused);f.view.focused=true;assert(f.view.search.focused);
  f.view.handleInput("\x15");for(const c of "STORED_THINKING_FINAL")f.view.handleInput(c);
  assert.equal(f.view.selectedId,E("f1"));f.view.handleInput("\r");f.render();
  assert(f.view.expandedIds.has(E("f1")));assert(content(f,"f1").includes("STORED_THINKING_FINAL"));
  assert(!f.view.search.focused);
});
test("clearing search restores folded paths and result-only content cannot be searched",()=>{
  const f=fixture();select(f,"u1");f.view.handleInput(key.left);f.view.handleInput("/");
  for(const c of "ALTERNATE_ANSWER")f.view.handleInput(c);assert(f.view.rows.some(r=>r.node.id===E("ax")));
  f.view.handleInput("\x15");f.view.handleInput("\x1b");assert(!f.view.rows.some(r=>r.node.id===E("ax")));
  f.view.handleInput("/");for(const c of "PRIVATE_FAIL_RESULT_BODY")f.view.handleInput(c);
  assert.equal(f.view.rows.length,0);
});
test("expanded event content scrolls and resizes without selecting another event",()=>{
  const f=fixture("dark",24);node(f.snapshot,"a2").body+="\n"+"Paragraph\n".repeat(50)+"LAST_LINE_999";
  select(f,"a2");f.view.handleInput("\r");f.render(48);const selected=f.view.selectedId;
  for(let i=0;i<15;i++){f.view.handleInput(key.pageDown);f.render(48);}
  assert(f.render(48).includes("LAST_LINE_999"));assert.equal(f.view.selectedId,selected);
  f.resize(14);assert.equal(f.view.render(96).length,14);
  for(let i=0;i<15;i++){f.view.handleInput(key.pageDown);f.render(96);}
  assert(f.render(96).includes("LAST_LINE_999"));
});
test("mouse opens a thinking group then an individual block, folds a branch and focuses search",()=>{
  const f=fixture("dark",80);openUser(f,"u1");f.render();
  const locate=id=>[...f.view.hits].find(([,hit])=>hit.id===id&&hit.kind==="node");
  const group=f.view.groupFor.get(E("a1"));
  let [y,hit]=locate(group);f.view.handleMouse(mouse(hit.fold[1]+1,y));f.render();
  assert(f.view.expandedGroups.has(group));
  [y,hit]=locate(E("a1"));f.view.handleMouse(mouse(30,y));f.render();
  assert(f.view.expandedIds.has(E("a1")));
  [y,hit]=locate(E("f1",1));f.view.handleMouse(mouse(hit.fold[0],y));
  assert(f.view.collapsed.has(E("f1",1)));assert(!f.view.rows.some(r=>r.node.id===E("ux")));
  f.view.handleMouse(mouse(4,2));assert(f.view.search.focused);
});
test("wheel scrolls without changing selection; drag/right-click do not activate anything",()=>{
  const f=fixture("dark",14);f.render();const selected=f.view.selectedId,offset=f.view.offset;
  f.view.handleMouse(mouse(4,5,"wheel",{wheelDelta:-3}));assert(f.view.offset<=offset);assert.equal(f.view.selectedId,selected);
  f.view.handleMouse(mouse(4,5,"click",{button:"right"}));f.view.handleMouse(mouse(4,5,"drag"));assert.deepEqual([...f.view.expandedIds],[E("u2"),E("a2")]);
});
test("terminal controls are stripped from titles and expanded body without changing stored text",()=>{
  const f=fixture();node(f.snapshot,"a2").body="Safe\x1b[2J\x1b]52;c;UNTRUSTED_CLIPBOARD\x07";
  node(f.snapshot,"a2").title=node(f.snapshot,"a2").body;
  select(f,"a2");assert(f.view.expandedIds.has(E("a2")));const inline=f.view.render(120).join("");
  f.view.handleInput("\r");const screen=inline+f.view.render(120).join("");
  assert(!screen.includes("\x1b[2J"));assert(!screen.includes("UNTRUSTED_CLIPBOARD"));
  assert(node(f.snapshot,"a2").body.includes("UNTRUSTED_CLIPBOARD"));
});
test("closing is idempotent and fresh instances reset expansion and folds",()=>{
  const f=fixture();f.view.handleInput("\r");f.view.handleInput("\x1b");f.view.handleInput("\x1b");assert.equal(f.closed,1);
  const next=fixture();assert.deepEqual([...next.view.expandedIds],[E("u2"),E("a2")]);assert.equal(next.view.expandedGroups.size,0);assert.equal(next.view.collapsed.size,0);
});
test("empty sessions show no fabricated events or current position",()=>{
  assert.deepEqual(sessionEvents([],null),{nodes:[],currentId:null});
  const view=new HistoryDemo([],themeFor("dark"),kb,()=>24,()=>{},()=>{},{live:true,currentId:null});
  assert(view.render(100).map(plain).join("\n").includes("Chưa có sự kiện"));assert.equal(view.documentLines.length,0);
});
test("command guards RPC/headless, uses raw entries by default and never reads real data in sample mode",async()=>{
  let command;treeDemo({registerCommand(name,options){assert.equal(name,"tree-v2");command=options;}});
  const notices=[];await command.handler("",{hasUI:true,mode:"rpc",ui:{notify:m=>notices.push(m),custom:()=>assert.fail("RPC custom")}});assert(notices[0].includes("cần Pi TUI"));
  const log=console.log;try{console.log=m=>notices.push(m);await command.handler("",{hasUI:false,mode:"print"});}finally{console.log=log;}
  let reads=0,closed=0;
  const ctx={hasUI:true,mode:"tui",sessionManager:{getEntries(){reads++;return entriesFixture();},getLeafId(){return "a2";}},ui:{custom(factory,options){
    assert(options.overlay);const view=factory({terminal:{rows:30},requestRender(){}},themeFor("dark"),kb,()=>closed++);
    if(closed===0){assert.equal(view.currentId,E("a2"));assert(view.nodes.some(n=>n.kind==="thinking"));}
    view.handleInput("\x1b");
  }}};
  await command.handler("",ctx);assert.equal(reads,1);await command.handler("sample",ctx);assert.equal(reads,1);assert.equal(closed,2);
});

test("consecutive healthy thinking blocks form a collapsed group without merging response text",()=>{
  const snapshot=sessionEvents([
    msg("u",null,"user","Question"),
    msg("a","u","assistant",[{type:"thinking",thinking:"ONE"},{type:"thinking",thinking:"TWO"},{type:"text",text:"Reply"},{type:"thinking",thinking:"THREE"}]),
  ],"a");
  const grouped=groupThinking(snapshot.nodes),groups=grouped.nodes.filter(n=>n.members);
  assert.deepEqual(groups.map(g=>g.members.length),[2,1]);
  assert.deepEqual(groups[0].members.map(n=>n.body),["ONE","TWO"]);
  assert.equal(grouped.nodes.find(n=>n.id===E("a",2)).parentId,groups[0].id);
  assert.equal(groups[1].parentId,E("a",2));
  assert.equal(snapshot.nodes.filter(n=>n.kind==="thinking").length,3,"raw projection stays ungrouped");
});
test("thinking groups stop at forks and failed thinking, preserving every branch",()=>{
  const s=sessionEvents([
    msg("u",null,"user","Question"),
    msg("t","u","assistant",[{type:"thinking",thinking:"Common"}]),
    msg("left","t","assistant",[{type:"thinking",thinking:"Left"}]),
    msg("right","t","assistant",[{type:"thinking",thinking:"Right"}]),
    msg("bad","right","assistant",[{type:"thinking",thinking:"Failed reasoning"}],{stopReason:"error"}),
    msg("after","bad","assistant",[{type:"thinking",thinking:"After failure"}]),
  ],"after");
  const g=groupThinking(s.nodes),common=g.groupFor.get(E("t"));
  assert.notEqual(g.groupFor.get(E("left")),common);assert.notEqual(g.groupFor.get(E("right")),common);
  assert.equal(g.groupFor.has(E("bad")),false);assert.equal(node(s,"bad").error,true);
  assert.equal(g.nodes.filter(n=>n.parentId===common).length,2);
  assert.equal(g.nodes.find(n=>n.id===g.groupFor.get(E("after"))).parentId,E("bad",1));
});
test("latest user lookup follows the actual leaf path instead of the latest written user",()=>{
  const s=sessionEvents(entriesFixture(),"a2");
  assert.equal(latestUserOnPath(s.nodes,s.currentId),E("u2"));
  assert.equal(latestUserOnPath(s.nodes,E("ax")),E("ux"));
  assert.equal(latestUserOnPath(s.nodes,E("sys")),null);
  assert.equal(latestUserOnPath(s.nodes,null),null);
});
test("only the last user on the current branch opens by default; healthy thinking groups stay closed",()=>{
  const f=fixture("dark",80);f.render();
  assert.equal(f.view.defaultUserId,E("u2"));assert.equal(f.view.selectedId,E("u2"));
  assert.deepEqual([...f.view.expandedIds],[E("u2"),E("a2")]);
  assert.deepEqual([...f.view.expandedUsers],[E("u2")]);
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
  assert.equal(content(f,"u2"),"","short user text is already shown in its header");
  assert.equal(content(f,"a2"),"");
  assert(f.view.documentLines.some(line=>line.header&&line.id===E("a2")&&line.text.includes("assistant: SECOND_ANSWER")));
  assert(!f.view.documentLines.some(line=>line.hit.kind==="content"));
  assert(!f.view.rows.some(row=>row.node.kind==="thinking"));
  assert.equal(f.view.expandedGroups.size,0);
  assert.equal(f.view.currentId,E("a2"));
});
test("moving selection never auto-opens another message; manual details remain independent",()=>{
  const f=fixture();select(f,"u1");f.view.handleInput(key.down);f.render();
  assert.deepEqual([...f.view.expandedIds],[E("u2"),E("a2")]);
  openUser(f,"u1");select(f,"a1",1);f.view.handleInput("\r");f.render();
  assert(f.view.expandedIds.has(E("u2")));assert(f.view.expandedIds.has(E("a1",1)));
  select(f,"u2");f.view.handleInput("\r");f.view.handleInput(key.down);f.render();
  assert(!f.view.expandedIds.has(E("u2")),"manually closed default user must not reopen on render");
});
test("opening/closing a thinking group hides only its members, not the subsequent response or branches",()=>{
  const f=fixture();openUser(f,"u1");f.render();const id=f.view.groupFor.get(E("a1"));
  assert(f.view.rows.some(row=>row.node.id===E("a1",1)));
  f.view.selectedId=id;f.view.handleInput("\r");f.render();
  assert(f.view.rows.some(row=>row.node.id===E("a1")));
  f.view.handleInput(key.right);assert.equal(f.view.selectedId,E("a1"));
  f.view.handleInput(key.left);assert.equal(f.view.selectedId,id);
  f.view.handleInput(key.left);f.render();
  assert(!f.view.rows.some(row=>row.node.id===E("a1")));
  assert(f.view.rows.some(row=>row.node.id===E("a1",1)));
  assert(f.view.rows.some(row=>row.node.id===E("ux")));
});
test("failed thinking keeps its body separate from the current assistant's inline preview",()=>{
  const s=sessionEvents([
    msg("u",null,"user","Question"),
    msg("good","u","assistant",[{type:"thinking",thinking:"NORMAL_THINKING"}]),
    msg("bad","good","assistant",[{type:"thinking",thinking:"ERROR_THINKING_DETAIL"},{type:"text",text:"ERROR_RESPONSE_DETAIL"}],{stopReason:"error"}),
  ],"bad");
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>40,()=>{},()=>{},{live:true,currentId:s.currentId});
  view.render(120);
  assert.equal(view.groupFor.has(E("bad")),false);
  assert(view.expandedIds.has(E("bad")));assert(view.expandedIds.has(E("bad",1)));
  assert(view.documentLines.some(l=>l.header&&l.id===E("bad",1)&&l.text.includes("assistant: ERROR_RESPONSE_DETAIL")));
  assert(!view.documentLines.some(l=>l.hit.kind==="content"&&l.id===E("bad",1)));
  assert(!view.expandedIds.has(E("good")));
  assert(view.documentLines.some(l=>l.hit.kind==="content"&&l.id===E("bad")&&l.text.includes("ERROR_THINKING_DETAIL")));
  view.selectedId=E("bad");view.handleInput("\r");view.render(120);
  assert(!view.expandedIds.has(E("bad")),"error thinking can still be closed manually");
});
test("a current thinking position moves its marker between the closed group and its real member",()=>{
  const s=sessionEvents([msg("u",null,"user","Question"),msg("a","u","assistant",[{type:"thinking",thinking:"One"},{type:"thinking",thinking:"Two"}])],"a");
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>28,()=>{},()=>{},{live:true,currentId:s.currentId});
  view.render(120);const group=view.groupFor.get(E("a",1));
  let markers=view.documentLines.filter(l=>l.header&&l.text.includes("● Hiện tại"));
  assert.deepEqual(markers.map(l=>l.id),[group]);
  view.selectedId=group;view.handleInput("\r");view.render(120);
  markers=view.documentLines.filter(l=>l.header&&l.text.includes("● Hiện tại"));
  assert.deepEqual(markers.map(l=>l.id),[E("a",1)]);assert.equal(view.currentId,E("a",1));
});
test("search temporarily opens matching thinking groups and clearing it restores compact state",()=>{
  const f=fixture();f.view.handleInput("/");for(const c of "STORED_THINKING_ONE")f.view.handleInput(c);
  assert.equal(f.view.selectedId,E("a1"));assert(f.view.rows.some(row=>row.node.id===E("a1")));
  assert.equal(f.view.expandedGroups.size,0);
  f.view.handleInput("\r");f.render();assert(content(f,"a1").includes("STORED_THINKING_ONE"));
  f.view.handleInput("/");f.view.handleInput("\x15");f.view.handleInput("\x1b");f.render();
  assert(!f.view.rows.some(row=>row.node.id===E("a1")));
  assert(!f.view.documentLines.some(l=>l.hit.kind==="content"&&l.id===E("a1")));
});
test("grouping and manual expansion never mutate original event IDs or parent links",()=>{
  const s=sessionEvents(entriesFixture(),"a2"),before=JSON.stringify(s);
  s.nodes.forEach(Object.freeze);
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>40,()=>{},()=>{},{currentId:s.currentId});
  view.selectedId=E("u1");view.handleInput("\r");view.render(120);
  const id=view.groupFor.get(E("a1"));view.selectedId=id;view.handleInput("\r");view.render(120);
  view.selectedId=E("a1");view.handleInput("\r");view.render(120);
  assert.equal(JSON.stringify(s),before);
});

test("old questions retain their actual text; only last user's work is visible by default",()=>{
  const f=fixture("dark",80);f.render();
  for(const [id,text] of [["u1","FIRST_QUESTION"],["u2","SECOND_QUESTION"],["ux","ALTERNATE_QUESTION"]]){
    const header=f.view.documentLines.find(line=>line.header&&line.id===E(id));
    assert(header.text.includes(`user: ${text}`));
    assert(!header.text.includes("user message"));
  }
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
  openUser(f,"u1");f.render();
  assert(f.view.rows.some(r=>r.node.id===E("a1",1)));
  assert(f.view.rows.some(r=>r.node.id===E("r2")));
  assert(!f.view.rows.some(r=>r.node.id===E("ax")),"unopened alternate section stays hidden");
  f.view.handleInput("\r");f.render();
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
  f.view.handleInput("/");for(const c of "FIRST_QUESTION")f.view.handleInput(c);
  assert.equal(f.view.selectedId,E("u1"));
  f.view.handleInput("\r");f.render();
  assert.equal(f.view.query,"");assert(f.view.rows.some(r=>r.node.id===E("a1",1)));
});

test("section projection follows raw ancestry, bridges hidden work and never mutates source links",()=>{
  const s=sessionEvents(entriesFixture(),"a2"),before=JSON.stringify(s),expanded=new Set([E("u2")]);
  s.nodes.forEach(Object.freeze);
  const v=userSections(s.nodes,expanded);
  assert.deepEqual(v.nodes.map(n=>n.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
  assert.equal(v.ownerFor.get(E("r2")),E("u1"));assert.equal(v.ownerFor.get(E("ax")),E("ux"));
  assert.equal(v.ownerFor.get(E("sys")),null);
  assert.equal(v.nodes.find(n=>n.id===E("u2")).parentId,E("u1"));
  assert.equal(v.nodes.find(n=>n.id===E("ux")).parentId,E("u1"));
  assert.equal(node(s,"u2").parentId,E("f1",1));
  assert.equal(userSections(s.nodes,expanded,"ALTERNATE_ANSWER").openUsers.has(E("ux")),true);
  assert.deepEqual([...expanded],[E("u2")]);assert.equal(JSON.stringify(s),before);
});
test("user left/right/Backspace fold only that user's work, never subsequent questions",()=>{
  const f=fixture();select(f,"u1");f.view.handleInput(key.right);
  assert(f.view.rows.some(r=>r.node.id===E("a1",1)));
  f.view.handleInput(key.left);
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
  assert(!f.view.collapsed.has(E("u1")));
  f.view.handleInput(key.right);f.view.handleInput("\x7f");
  assert(!f.view.expandedUsers.has(E("u1")));
  assert(f.view.rows.some(r=>r.node.id===E("u2"))&&f.view.rows.some(r=>r.node.id===E("ux")));
});
test("clicking an old question opens work and its caret closes work while retaining all user rows",()=>{
  const f=fixture("dark",80);f.render();
  const locate=()=>[...f.view.hits].find(([,hit])=>hit.id===E("u1")&&hit.kind==="node");
  let [y,hit]=locate();f.view.handleMouse(mouse(hit.fold[1]+2,y));f.render();
  assert(f.view.rows.some(r=>r.node.id===E("r1")));
  [y,hit]=locate();f.view.handleMouse(mouse(hit.fold[0],y));f.render();
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
});
test("closing the current user rolls the marker onto its question without moving the real leaf",()=>{
  const f=fixture("dark",80);select(f,"u2");f.view.handleInput("\r");f.render();
  assert(!f.view.rows.some(r=>r.node.id===E("a2")));
  assert.deepEqual(f.view.documentLines.filter(l=>l.text.includes("● Hiện tại")).map(l=>l.id),[E("u2")]);
  assert.equal(f.view.currentId,E("a2"));
  f.view.handleInput(key.right);f.render();
  assert.deepEqual(f.view.documentLines.filter(l=>l.text.includes("● Hiện tại")).map(l=>l.id),[E("a2")]);
});
test("even failed thinking in an older question stays hidden until that question is opened",()=>{
  const s=sessionEvents([
    msg("old",null,"user","OLD_QUESTION"),
    msg("bad","old","assistant",[{type:"thinking",thinking:"OLD_ERROR_DETAIL"},{type:"text",text:"OLD_FAILED_RESPONSE"}],{stopReason:"error"}),
    msg("new","bad","user","LATEST_QUESTION"),msg("reply","new","assistant","LATEST_RESPONSE"),
  ],"reply");
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>40,()=>{},()=>{},{currentId:s.currentId});
  view.render(120);
  assert(!view.documentLines.some(l=>/OLD_ERROR_DETAIL|OLD_FAILED_RESPONSE/.test(l.text)));
  view.selectedId=E("old");view.handleInput("\r");view.render(120);
  assert(view.documentLines.some(l=>l.hit.kind==="content"&&l.text.includes("OLD_ERROR_DETAIL")));
  assert(view.rows.some(r=>r.node.id===E("new")));
});
test("long questions have full text only in open sections; short questions aren't duplicated",()=>{
  const f=fixture("dark",80);
  node(f.snapshot,"u1").body+="\n"+"older question detail ".repeat(15)+"OLD_FULL_TEXT_END";
  node(f.snapshot,"u2").body+="\n"+"current question detail ".repeat(15)+"CURRENT_FULL_TEXT_END";
  f.render();assert(content(f,"u2").includes("CURRENT_FULL_TEXT_END"));assert.equal(content(f,"u1"),"");
  openUser(f,"u1");f.render();assert(content(f,"u1").includes("OLD_FULL_TEXT_END"));
  f.view.handleInput("\r");f.render();assert.equal(content(f,"u1"),"");
  assert(f.view.rows.some(r=>r.node.id===E("u2")));
});
test("search can temporarily reveal old work without permanently opening its user section",()=>{
  const f=fixture();f.view.handleInput("/");for(const c of "FINAL_ANSWER_ONE")f.view.handleInput(c);
  assert(f.view.rows.some(r=>r.node.id===E("f1",1)));
  assert(!f.view.expandedUsers.has(E("u1")));assert(f.view.openUsers.has(E("u1")));
  f.view.handleInput("\x15");f.view.handleInput("\x1b");f.render();
  assert.deepEqual(f.view.rows.map(r=>r.node.id),[E("u1"),E("u2"),E("a2"),E("ux")]);
});

test("latest-user thinking, assistant and tool titles are visible while old responses remain hidden",()=>{
  const s=sessionEvents([
    msg("old",null,"user","OLD_QUESTION"),msg("answer","old","assistant","OLD_RESPONSE"),
    msg("new","answer","user","CURRENT_QUESTION"),
    msg("work","new","assistant",[
      {type:"thinking",thinking:"CURRENT_THINKING_BODY"},
      {type:"toolCall",id:"t",name:"read",arguments:{path:"CURRENT_FILE.ts"}},
      {type:"text",text:"CURRENT_RESPONSE"},
    ]),
    msg("result","work","toolResult","PRIVATE_CURRENT_OUTPUT",{toolCallId:"t",toolName:"read",isError:false}),
  ],"result");
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>40,()=>{},()=>{},{currentId:s.currentId});
  view.render(120);const text=view.documentLines.map(l=>l.text).join("\n");
  for(const label of ["user: OLD_QUESTION","user: CURRENT_QUESTION","thinking","tool call: read CURRENT_FILE.ts","assistant:","CURRENT_RESPONSE","tool: read CURRENT_FILE.ts"])assert(text.includes(label));
  for(const hidden of ["OLD_RESPONSE","CURRENT_THINKING_BODY","PRIVATE_CURRENT_OUTPUT"])assert(!text.includes(hidden));
  assert.equal(view.currentId,E("result"));assert.deepEqual([...view.expandedUsers],[E("new")]);
});

test("current responses have one inline header preview; Enter reads full bodies on the actual branch",()=>{
  const entries=[
    msg("old",null,"user","OLD_QUESTION"),msg("old-answer","old","assistant","OLD_RESPONSE"),
    msg("current","old-answer","user","thu gen cai gi dai di"),
    msg("work","current","assistant",[
      {type:"text",text:"Current introduction ".repeat(20)+"\n\nINTRODUCTION_DETAIL_END"},
      {type:"thinking",thinking:"CURRENT_HEALTHY_THINKING_BODY"},
      {type:"toolCall",id:"t",name:"read",arguments:{path:"file.ts"}},
      {type:"text",text:"Current progress ".repeat(20)+"\n\nPROGRESS_DETAIL_END"},
    ]),
    msg("result","work","toolResult","PRIVATE_CURRENT_TOOL_OUTPUT",{toolCallId:"t",toolName:"read",isError:true}),
    msg("final","result","assistant","# Current story\n\nFIRST_STORY_PARAGRAPH "+"story words ".repeat(60)+"\n\n"+"Later paragraph.\n".repeat(25)+"CURRENT_STORY_DETAIL_END"),
    msg("other","old-answer","user","OTHER_BRANCH_QUESTION"),msg("other-answer","other","assistant","OTHER_BRANCH_RESPONSE"),
  ];
  const s=sessionEvents(entries,"final"),before=JSON.stringify(s);
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>80,()=>{},()=>{},{currentId:s.currentId});
  view.render(120);
  const responses=[[E("work"),"INTRODUCTION_DETAIL_END"],[E("work",3),"PROGRESS_DETAIL_END"],[E("final"),"CURRENT_STORY_DETAIL_END"]];
  for(const [id,end] of responses){
    assert(view.expandedIds.has(id));assert(view.assistantPreviews.has(id));
    const lines=view.documentLines.filter(l=>l.id===id);
    assert.equal(lines.length,1);assert(lines[0].header);assert(lines[0].text.includes("assistant:"));
    assert(!lines[0].text.includes(end));assert(lines[0].text.includes("…"));
  }
  assert(view.documentLines.some(l=>l.header&&l.id===E("final")&&l.text.includes("assistant: FIRST_STORY_PARAGRAPH")));
  assert(!view.documentLines.some(l=>l.text.includes("# Current story")||l.text.includes("Later paragraph")));
  assert.equal(view.defaultUserId,E("current"));assert.equal(view.selectedId,E("current"));
  assert(!view.expandedIds.has(E("old-answer")));assert(!view.expandedIds.has(E("other-answer")));
  assert(!view.expandedIds.has(E("work",1)));assert.equal(view.expandedGroups.size,0);
  const text=view.documentLines.map(l=>l.text).join("\n");
  for(const hidden of ["OLD_RESPONSE","OTHER_BRANCH_RESPONSE","CURRENT_HEALTHY_THINKING_BODY","PRIVATE_CURRENT_TOOL_OUTPUT"])assert(!text.includes(hidden));
  for(const [id,end] of responses){
    view.selectedId=id;view.handleInput("\r");view.render(120);
    assert(!view.assistantPreviews.has(id));
    assert(view.documentLines.some(l=>l.id===id&&l.hit.kind==="content"&&l.text.includes(end)));
    view.handleInput("\r");view.render(120);
    assert(!view.documentLines.some(l=>l.id===id&&l.hit.kind==="content"));
  }
  assert.equal(JSON.stringify(s),before);
});
test("manually closing a current response stays closed through navigation, rendering and user-section toggles",()=>{
  const f=fixture();f.render();assert.equal(content(f,"a2"),"");
  assert(f.view.documentLines.some(l=>l.header&&l.id===E("a2")&&l.text.includes("assistant: SECOND_ANSWER")));
  select(f,"a2");f.view.handleInput("\x7f");f.render();assert.equal(content(f,"a2"),"");
  f.view.handleInput(key.up);f.view.handleInput(key.down);f.render(80);
  assert(!f.view.expandedIds.has(E("a2")));
  select(f,"u2");f.view.handleInput("\r");f.view.handleInput("\r");f.render();
  assert.equal(content(f,"a2"),"");
  const next=fixture();next.render();assert(next.view.assistantPreviews.has(E("a2")));
  assert(next.view.documentLines.some(l=>l.header&&l.id===E("a2")&&l.text.includes("assistant: SECOND_ANSWER")));
});

test("assistant excerpts stay on one header line after resize with no separate body preview",()=>{
  const s=sessionEvents([
    msg("u",null,"user","Question"),
    msg("a","u","assistant","# Tiêu đề\n\nMỞ_ĐOẠN "+"Nội dung tiếng Việt 🍃 rất dài. ".repeat(40)+"\n\nSECOND_PARAGRAPH_HIDDEN"),
  ],"a"),before=JSON.stringify(s);
  const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>40,()=>{},()=>{},{currentId:s.currentId});
  for(const width of [32,48,80,120,200]){
    const screen=view.render(width);assert(screen.every(line=>visibleWidth(line)<=width));
    const lines=view.documentLines.filter(l=>l.id===E("a"));
    assert.equal(lines.length,1);assert(lines[0].header);assert(!lines[0].text.includes("\n"));
    assert(lines[0].text.includes("assistant:"));assert(lines[0].text.includes("MỞ_ĐOẠN"));assert(lines[0].text.includes("…"));
    assert(!view.documentLines.some(l=>l.text.includes("SECOND_PARAGRAPH_HIDDEN")||l.text.includes("# Tiêu đề")));
  }
  assert.equal(JSON.stringify(s),before);
});
test("short assistant paragraphs and heading-only replies remain readable without an unnecessary ellipsis",()=>{
  for(const text of ["One short paragraph.","# Heading only","Line one\nLine two"]){
    const s=sessionEvents([msg("u",null,"user","Question"),msg("a","u","assistant",text)],"a");
    const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>30,()=>{},()=>{},{currentId:s.currentId});
    view.render(120);
    const lines=view.documentLines.filter(l=>l.id===E("a"));
    assert.equal(lines.length,1);assert(lines[0].header);assert(lines[0].text.includes(`assistant: ${text.replace(/\s+/g," ")}`));
    assert(!lines[0].text.includes("…"));
  }
});

test("work is indented two columns beneath its user while preserving forks, thinking nesting and mouse targets",()=>{
  const f=fixture("dark",80);openUser(f,"u1");
  const group=f.view.groupFor.get(E("a1"));f.view.selectedId=group;f.view.handleInput("\r");f.render();
  const header=id=>f.view.documentLines.find(l=>l.header&&l.id===id);
  const caret=id=>header(id).text.search(/[▾▸·]/);
  for(const row of f.view.rows){
    const line=header(row.node.id),owner=f.view.ownerFor.get(row.node.members?.[0]?.id??row.node.id);
    const expected=3+visibleWidth(row.prefix)+(row.node.kind!=="user"&&owner?2:0);
    assert.equal(caret(row.node.id),expected);
    if(line.hit.fold)assert.equal(line.hit.fold[0],expected,"mouse fold region must move with the caret");
  }
  for(const id of [group,E("a1",1),E("a1",2),E("r1")])assert.equal(caret(id)-caret(E("u1")),2);
  assert.equal(caret(E("a2"))-caret(E("u2")),2);
  assert(caret(E("a1"))>caret(group),"thinking members retain their existing nested indent");
  select(f,"a2");f.view.handleInput("\r");f.render();
  const body=f.view.documentLines.find(l=>l.id===E("a2")&&l.hit.kind==="content");
  assert.equal(body.text.indexOf("SECOND_ANSWER")-header(E("a2")).text.indexOf("assistant:"),2);
  assert.equal(JSON.stringify(f.source),f.before);assert.equal(f.view.currentId,E("a2"));
});

function navigationFixture(){
  const source=entriesFixture(),snapshot=sessionEvents(source,"a2");let chosen,closed=0;
  const view=new HistoryDemo(snapshot.nodes,themeFor("dark"),kb,()=>80,()=>{},()=>closed++,{
    currentId:snapshot.currentId,live:true,onNavigate:target=>{chosen=target;},
  });
  return {view,snapshot,render:()=>view.render(120).map(plain).join("\n"),get chosen(){return chosen;},get closed(){return closed;}};
}
test("live Enter chooses the selected user entry once and closes, instead of toggling its work",()=>{
  const f=navigationFixture();f.render();select(f,"u1");f.view.handleInput("\r");
  assert.deepEqual(f.chosen,{entryId:"u1",nodeId:E("u1")});assert(f.view.closed);
  f.view.handleInput("\r");assert.equal(f.closed,0,"selection must not invoke cancellation callback");
  assert.equal(f.view.currentId,E("a2"));
});
test("live Space and clicks expand without navigating; Enter on tool/text blocks uses persisted entry IDs",()=>{
  for(const [id,part] of [["a1",1],["a1",2],["r2",0]]){
    const f=navigationFixture();select(f,"u1");f.view.handleInput(" ");f.render();
    assert(f.view.expandedUsers.has(E("u1")));assert.equal(f.chosen,undefined);
    select(f,id,part);f.view.handleInput("\r");
    assert.deepEqual(f.chosen,{entryId:id,nodeId:E(id,part)});
  }
  const f=navigationFixture();f.render();
  const [y,hit]=[...f.view.hits].find(([,h])=>h.id===E("u1")&&h.kind==="node");
  f.view.handleMouse(mouse(hit.fold[1]+2,y));assert(f.view.expandedUsers.has(E("u1")));assert.equal(f.chosen,undefined);
});
test("Enter on a closed thinking group navigates to its final real entry, not a synthetic group ID",()=>{
  const s=sessionEvents([msg("u",null,"user","Question"),msg("one","u","assistant",[{type:"thinking",thinking:"One"}]),msg("two","one","assistant",[{type:"thinking",thinking:"Two"}])],"two");
  let chosen;const view=new HistoryDemo(s.nodes,themeFor("dark"),kb,()=>30,()=>{},()=>{}, {currentId:s.currentId,onNavigate:t=>chosen=t});
  const group=view.groupFor.get(E("one"));view.selectedId=group;view.handleInput("\r");
  assert.deepEqual(chosen,{entryId:"two",nodeId:group});
});
test("Enter in live search navigates to the actual match; Escape/empty matches never navigate",()=>{
  const f=navigationFixture();f.view.handleInput("/");for(const c of "ALTERNATE_ANSWER")f.view.handleInput(c);
  f.view.handleInput("\r");assert.deepEqual(f.chosen,{entryId:"ax",nodeId:E("ax")});
  const empty=navigationFixture();empty.view.handleInput("/");for(const c of "NO_MATCH_999")empty.view.handleInput(c);
  empty.view.handleInput("\r");assert.equal(empty.chosen,undefined);assert(!empty.view.closed);
  empty.view.handleInput("\x1b");assert.equal(empty.closed,1);assert.equal(empty.chosen,undefined);
});
test("live footer distinguishes navigation from expansion and initial selection can reveal an old section",()=>{
  const f=navigationFixture();assert(f.render().includes("Enter Chuyển tới"));assert(f.render().includes("Space/click Bung/thu"));
  const view=new HistoryDemo(f.snapshot.nodes,themeFor("dark"),kb,()=>50,()=>{},()=>{}, {currentId:E("a2"),selectedId:E("a1"),onNavigate:()=>{}});
  assert.equal(view.selectedId,E("a1"));assert(view.expandedUsers.has(E("u1")));assert(view.rows.some(r=>r.node.id===E("a1")));
});

async function navigationCommand({actions=[v=>{v.selectedId=E("u1");v.handleInput("\r");}],choices=["Không tóm tắt"],editors=[],idle=true,result={cancelled:false},error}={}){
  let command;treeDemo({registerCommand(_name,c){command=c;}});
  const calls=[],notices=[],order=[],views=[];let reads=0,selects=0;
  const ctx={hasUI:true,mode:"tui",sessionManager:{getEntries(){reads++;return entriesFixture();},getLeafId(){return "a2";}},
    isIdle:()=>idle,abort(){order.push("abort");},async waitForIdle(){order.push("idle");},
    async navigateTree(id,options){order.push("navigate");calls.push({id,options});if(error)throw Error(error);return result;},
    ui:{notify(message,tone){notices.push({message,tone});},async select(title,options){selects++;order.push("prompt");assert(title.includes("Tóm tắt"));assert.equal(options.length,3);assert(views.at(-1).closed);return choices.shift();},async editor(){order.push("editor");return editors.shift();},
      custom(factory){return new Promise(resolve=>{const view=factory({terminal:{rows:50},requestRender(){}},themeFor("dark"),kb,resolve);views.push(view);const action=actions.shift();assert(action,"unexpected tree reopen");action(view);});},
    },
  };
  await command.handler("",ctx);return {calls,notices,order,views,reads,selects};
}
test("command delegates no-summary navigation only after closing the overlay; no direct session writes",async()=>{
  const f=await navigationCommand();assert.deepEqual(f.calls,[{id:"u1",options:{summarize:false,customInstructions:undefined}}]);
  assert.deepEqual(f.order,["prompt","navigate"]);assert.equal(f.reads,1);
});
test("choosing current leaf is a no-op without a summary prompt",async()=>{
  const f=await navigationCommand({actions:[v=>{v.selectedId=E("a2");v.handleInput("\r");}]});
  assert.equal(f.calls.length,0);assert.equal(f.selects,0);assert(f.notices[0].message.includes("Đang ở"));
});
test("summary cancellation returns to selected old node without navigating; Escape then exits",async()=>{
  const f=await navigationCommand({actions:[v=>{v.selectedId=E("u1");v.handleInput(" ");v.selectedId=v.groupFor.get(E("a1"));v.handleInput("\r");},v=>{assert.equal(v.selectedId,v.groupFor.get(E("a1")));assert(v.expandedUsers.has(E("u1")));v.handleInput("\x1b");}],choices:[undefined]});
  assert.equal(f.calls.length,0);assert.equal(f.views.length,2);assert.equal(f.reads,2);
});
test("summary and custom summary are explicit native navigateTree options",async()=>{
  const plain=await navigationCommand({choices:["Tóm tắt"]});assert.equal(plain.calls[0].options.summarize,true);
  const custom=await navigationCommand({choices:["Tóm tắt với hướng dẫn riêng"],editors:["Keep decisions"]});
  assert.deepEqual(custom.calls[0].options,{summarize:true,customInstructions:"Keep decisions"});
  const cancelledEditor=await navigationCommand({choices:["Tóm tắt với hướng dẫn riêng","Không tóm tắt"],editors:[undefined]});
  assert.equal(cancelledEditor.selects,2);assert.equal(cancelledEditor.calls[0].options.summarize,false);
});
test("confirmed navigation aborts a running response then waits; cancellation never aborts",async()=>{
  const f=await navigationCommand({idle:false});assert.deepEqual(f.order,["prompt","abort","idle","navigate"]);
  const cancel=await navigationCommand({idle:false,choices:[undefined],actions:[v=>{v.handleInput("\r");},v=>v.handleInput("\x1b")]});
  assert.deepEqual(cancel.order,["prompt"]);assert.equal(cancel.calls.length,0);
});
test("native cancellations and navigation conflicts are surfaced without manual branch mutation",async()=>{
  const cancel=await navigationCommand({result:{cancelled:true}});assert(cancel.notices.some(n=>n.message.includes("Đã hủy")));
  const failure=await navigationCommand({error:"Compaction in progress"});assert.deepEqual(failure.notices,[{message:"Compaction in progress",tone:"error"}]);
});

test("sample Enter only expands synthetic work and never navigates or prompts for a summary",async()=>{
  let command,view;treeDemo({registerCommand(_name,c){command=c;}});
  await command.handler("sample",{hasUI:true,mode:"tui",ui:{
    custom(factory){return new Promise(resolve=>{view=factory({terminal:{rows:40},requestRender(){}},themeFor("dark"),kb,resolve);
      assert.equal(view.onNavigate,undefined);const first=view.rows.find(r=>r.node.kind==="user").node;
      view.selectedId=first.id;view.handleInput("\r");assert(view.expandedUsers.has(first.id));view.handleInput("\x1b");});},
    select(){assert.fail("sample cannot ask about real navigation");},
  },navigateTree(){assert.fail("sample cannot navigate real session");}});
  assert(view.closed);
});

test("tree uses live semantic theme tokens for panels, selection, thinking, tools and errors",()=>{
  const s=sessionEvents(entriesFixture(),"a2");let active=themeFor("dark"),calls=[];
  const themed={style(text,options){calls.push({text,options});return active.style(text,options);},getBgAnsi:token=>active.getBgAnsi(token)};
  const view=new HistoryDemo(s.nodes,active,kb,()=>80,()=>{},()=>{}, {currentId:s.currentId,getTheme:()=>themed});
  view.selectedId=E("u1");view.handleInput(" ");
  const midnight=loadThemeFromPath(fileURLToPath(new URL("../../themes/midnight-aurora.json",import.meta.url)));
  for(const theme of [themeFor("dark"),themeFor("light"),midnight]){
    active=theme;calls=[];const screen=view.render(120);
    assert(screen.every(line=>visibleWidth(line)<=120));
    assert(calls.some(c=>c.options.bg==="selectedBg"&&c.options.fg==="accent"));
    assert(calls.some(c=>c.options.bg==="customMessageBg"));
    assert(calls.some(c=>c.options.fg==="borderAccent"));
    assert(calls.some(c=>c.options.fg==="thinkingText"));
    assert(calls.some(c=>c.options.fg==="toolTitle"));
    assert(calls.some(c=>c.options.fg==="error"));
    assert(screen.join("").includes(theme.getBgAnsi("customMessageBg")));
    view.handleInput("/");view.render(80);assert(calls.some(c=>c.text==="  / "&&c.options.bg==="customMessageBg"));
    view.handleInput("\x1b");
  }
});
