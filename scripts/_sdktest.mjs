import { TrueForge, isEventDelta, mergeEventDelta } from "@truefoundry/trueforge-sdk";
const c = new TrueForge({ baseUrl: "http://localhost:8790" });
const s = await c.sessions.create({ agent: { spec: { model: { name: "google-gemini/gemini-3-6-flash" }, instructions: "Use your tools to answer.", mcpServers: [{ name: "deepwiki", requireApprovalForTools: ["@all"] }] } } });
const sid = s.data.id;
const msgs = {};
async function run(input) {
  const stream = await c.sessions.createTurnStream(sid, { input });
  let pending = null;
  for await (const ev of stream) {
    if (isEventDelta(ev)) { if (msgs[ev.id]) mergeEventDelta(msgs[ev.id], ev); continue; }
    if (ev.type === "model.message") msgs[ev.id] = ev;
    console.log(ev.type, JSON.stringify(ev).slice(0, 400));
    if (ev.type === "tool.approval_required") pending = ev;
  }
  for (const m of Object.values(msgs)) if (m.toolCalls?.length) console.log("MERGED toolCalls", JSON.stringify(m.toolCalls).slice(0, 400));
  return pending;
}
const p = await run([{ type: "user.message", content: "What language is the repo facebook/react written in? Use deepwiki." }]);
if (p) {
  console.log("---- approving");
  await run(p.toolCalls.map(tc => ({ type: "user.tool_approval", threadId: p.threadId, toolCallId: tc.id, approval: { status: "allow" } })));
}
