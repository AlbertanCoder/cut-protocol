// A fake Anthropic client for driving llm.runToolLoop / the selector with
// SCRIPTED model turns — no network, no key. Each messages.create() returns the
// next scripted response (or a benign empty one once exhausted) and records
// every call, so tests can assert exactly how many turns ran and with what.
let _seq = 0;

function text(t) {
  return { type: "text", text: t };
}

function toolUse(name, input = {}, id) {
  return { type: "tool_use", name, input, id: id || `tu_${++_seq}` };
}

// scripts: array of { content: [blocks], stop_reason } (or just an array of
// blocks, which is wrapped). Blocks are text()/toolUse().
function makeMockClient(scripts = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    get callCount() {
      return calls.length;
    },
    client: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const s = i < scripts.length ? scripts[i] : { content: [text("{}")], stop_reason: "end_turn" };
          i++;
          return Array.isArray(s) ? { content: s, stop_reason: "end_turn" } : s;
        },
      },
    },
  };
}

module.exports = { makeMockClient, text, toolUse };
