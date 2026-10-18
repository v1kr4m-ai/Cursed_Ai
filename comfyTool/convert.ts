/**
 * Converts ComfyUI's UI-format workflow export (nodes/links arrays, from Ctrl+S) into the API format that
 * ComfyUI executes (flat node_id -> { class_type, inputs, _meta }) - the same shape "Save (API Format)" gives.
 *
 * Doing this correctly needs each node class's input schema (names, ORDER, widget vs socket), because the UI
 * format stores widget values positionally with no names. That schema is a running ComfyUI's /object_info,
 * passed in as a plain object (keeps this module testable with a small fixture).
 *
 * Also resolves through the organisational nodes that have no real class of their own: Reroute, rgthree
 * Set/GetNode, bypassed (mode 4) and muted (mode 2) nodes, PrimitiveNode (value inlined), and Subgraphs
 * (flattened first, inner ids prefixed "<instance>:<inner>" like ComfyUI's own export).
 *
 * Ported from the original Python "From Prompt" tool (backend/workflow_converter.py).
 */

type Id = number | string;
type Link = [Id, Id, number, Id, number, any];
type Json = Record<string, any>;

// Typeable widget types; every other type tag is a link-only socket. COMFY_* are newer dynamic inputs (they carry a value too).
const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);
const SKIP_TYPES = new Set(["Note", "MarkdownNote", "Label (rgthree)", "Fast Groups Muter (rgthree)", "Fast Groups Bypasser (rgthree)"]);
const PASSTHROUGH_TYPES = new Set(["Reroute", "SetNode", "GetNode"]);
const MODE_MUTED = 2, MODE_BYPASS = 4;
// Reference loaders stay in the graph even when bypassed/muted in the editor: people park a spare slot that way,
// and the app decides per run whether a slot is used.
const REF_LOADER_TYPES = new Set(["LoadImage", "LoadImageMask", "VHS_LoadVideo", "LoadVideo", "LoadAudio"]);
// The editor gives any seed-like INT widget a companion "control after generate" value right after it.
const SEED_INPUTS = new Set(["seed", "noise_seed"]);
const CONTROL_MODES = ["fixed", "increment", "decrement", "randomize"];

export interface ConvertResult {
  apiWorkflow: Record<string, any>;
  skippedNodes: [string, string, string][];
  unknownTypes: [string, string][];
  danglingLinks: [string, string, string][];
  ok: boolean;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const key2 = (id: Id, slot: number) => `${typeof id}:${id}|${slot}`;

function expandOneSubgraph(instance: Json, sg: Json, nodes: Json[], links: Link[]): [Json[], Link[]] {
  const iid = instance.id;
  const prefix = `${iid}:`;
  const outerById = new Map<any, Link>(links.map(l => [l[0], l]));
  const instInputs: Json[] = instance.inputs || [];

  // A subgraph input that isn't wired at the outer level is a "promoted widget": its value lives in the
  // instance's own widgets_values, in the order of the instance's widget-flagged input slots.
  const widgetSlots = instInputs.filter(s => "widget" in s);
  const promoted: Record<string, any> = {};
  widgetSlots.forEach((slot, i) => { if (i < (instance.widgets_values || []).length) promoted[slot.name] = instance.widgets_values[i]; });

  const innerNodes: Json[] = clone(sg.nodes || []);
  for (const node of innerNodes) {
    node.id = `${prefix}${node.id}`;
    for (const slot of node.inputs || []) if (slot.link != null) slot.link = `${prefix}L${slot.link}`;
  }

  const newLinks: Link[] = [];
  const constNodes: Json[] = [];
  const outmap = new Map<string, [Id, number]>();
  for (const lk of sg.links || []) {
    const origin = lk.origin_id, oSlot = lk.origin_slot, target = lk.target_id, tSlot = lk.target_slot;
    const linkId = `${prefix}L${lk.id}`, linkType = lk.type;

    let outer: Link | undefined;
    let slot: Json = {};
    if (origin === -10) { // fed by one of the subgraph's own inputs
      slot = oSlot < instInputs.length ? instInputs[oSlot] : {};
      outer = outerById.get(slot.link);
    }
    if (target === -20) { // feeds one of the subgraph's outputs
      if (origin !== -10) outmap.set(key2(iid, tSlot), [`${prefix}${origin}`, oSlot]);
      else if (outer) outmap.set(key2(iid, tSlot), [outer[1], outer[2]]);
      continue;
    }
    const targetId = `${prefix}${target}`;
    if (origin !== -10) newLinks.push([linkId, `${prefix}${origin}`, oSlot, targetId, tSlot, linkType]);
    else if (outer) newLinks.push([linkId, outer[1], outer[2], targetId, tSlot, linkType]);
    else if (slot.name in promoted) {
      const constId = `${prefix}const${oSlot}`;
      constNodes.push({ id: constId, type: "PrimitiveNode", widgets_values: [promoted[slot.name]], _synthetic: true });
      newLinks.push([linkId, constId, 0, targetId, tSlot, linkType]);
    }
    // else: unwired and no promoted value - the inner node keeps its own widget value
  }

  const rewired: Link[] = [];
  for (let link of links) {
    if (link[3] === iid) continue; // fed the instance; consumed above
    if (link[1] === iid) {
      const mapped = outmap.get(key2(iid, link[2]));
      if (!mapped) continue;
      link = [link[0], mapped[0], mapped[1], link[3], link[4], link[5]];
    }
    rewired.push(link);
  }
  return [[...nodes.filter(n => n !== instance), ...innerNodes, ...constNodes], [...rewired, ...newLinks]];
}

function expandSubgraphs(ui: Json): [Json[], Link[]] {
  const defs = new Map<string, Json>(((ui.definitions || {}).subgraphs || []).map((sg: Json) => [sg.id, sg]));
  let nodes: Json[] = clone(ui.nodes || []);
  let links: Link[] = (ui.links || []).map((l: any) => [...l] as Link);
  for (let i = 0; i < 10000; i++) { // each pass removes one instance; the bound guards a cyclic definition
    const instance = nodes.find(n => defs.has(n.type));
    if (!instance) break;
    [nodes, links] = expandOneSubgraph(instance, defs.get(instance.type)!, nodes, links);
  }
  return [nodes, links];
}

/** The link a bypassed node forwards to output `outSlot`: ComfyUI matches by socket type, else the same slot index. */
function bypassLink(node: Json, outSlot: number, linksById: Map<any, Link>): Link | undefined {
  const inputs: Json[] = node.inputs || [];
  const outputs: Json[] = node.outputs || [];
  const outType = outSlot < outputs.length ? outputs[outSlot].type : undefined;
  for (const slot of inputs) if (slot.link != null && slot.type === outType) return linksById.get(slot.link);
  if (outSlot < inputs.length && inputs[outSlot].link != null) return linksById.get(inputs[outSlot].link);
  return undefined;
}

/** (node_id, output_slot) -> the link that "really" feeds that output (Reroute / Set / Get / bypassed nodes). */
function buildPassthroughMap(nodes: Json[], linksById: Map<any, Link>) {
  const passthrough = new Map<string, Link | undefined>();
  const setnodeLinkByName = new Map<any, Link | undefined>();
  for (const node of nodes) {
    const t = node.type;
    if (t === "Reroute" || t === "SetNode") {
      const slots: Json[] = node.inputs || [];
      const link = slots.length ? linksById.get(slots[0].link) : undefined;
      passthrough.set(key2(node.id, 0), link);
      if (t === "SetNode") {
        const w = node.widgets_values || [];
        const name = w.length ? w[0] : null;
        if (name != null) setnodeLinkByName.set(name, link);
      }
    } else if (node.mode === MODE_BYPASS && !SKIP_TYPES.has(t) && !PASSTHROUGH_TYPES.has(t)) {
      for (let out = 0; out < (node.outputs || []).length; out++) {
        const link = bypassLink(node, out, linksById);
        if (link) passthrough.set(key2(node.id, out), link);
      }
    }
  }
  for (const node of nodes) {
    if (node.type === "GetNode") {
      const w = node.widgets_values || [];
      const name = w.length ? w[0] : null;
      passthrough.set(key2(node.id, 0), setnodeLinkByName.get(name));
    }
  }
  return passthrough;
}

/** Follow a link back through any chain of passthrough nodes: ["link", [id, slot]] | ["value", literal] | null. */
function resolveLink(link: Link | undefined, passthrough: Map<string, Link | undefined>, primitives: Map<any, Json>): ["link", [string, number]] | ["value", any] | null {
  const visited = new Set<string>();
  while (link) {
    const origin = link[1], slot = link[2];
    const k = key2(origin, slot);
    if (visited.has(k)) return null;
    visited.add(k);
    if (primitives.has(origin)) {
      const values = primitives.get(origin)!.widgets_values || [];
      return values.length ? ["value", values[0]] : null;
    }
    if (passthrough.has(k)) { link = passthrough.get(k); continue; }
    return ["link", [String(origin), slot]];
  }
  return null;
}

/** Could `value` be a saved value for a widget of this type? (Older node versions can hold a different layout.) */
function fits(typeTag: any, value: any): boolean {
  if (typeTag === "INT" || typeTag === "FLOAT") {
    if (typeof value === "boolean") return false;
    if (typeof value === "number") return true;
    return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value.replace(/,/g, "")));
  }
  if (typeTag === "BOOLEAN") return typeof value === "boolean";
  return true;
}

const isLinkValue = (v: any) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string";

export function convertUiWorkflow(ui: Json, objectInfo: Json): ConvertResult {
  const [nodes, links] = expandSubgraphs(ui);
  const linksById = new Map<any, Link>(links.map(l => [l[0], l]));
  const passthrough = buildPassthroughMap(nodes, linksById);
  const primitives = new Map<any, Json>(nodes.filter(n => n.type === "PrimitiveNode").map(n => [n.id, n]));

  const result: ConvertResult = { apiWorkflow: {}, skippedNodes: [], unknownTypes: [], danglingLinks: [], ok: true };

  for (const node of nodes) {
    const nodeId = String(node.id);
    const nodeType: string = node.type;

    if (SKIP_TYPES.has(nodeType)) { result.skippedNodes.push([nodeId, nodeType, "UI-only annotation node"]); continue; }
    if (PASSTHROUGH_TYPES.has(nodeType)) { result.skippedNodes.push([nodeId, nodeType, "passthrough - resolved through, not a real node"]); continue; }
    if ((node.mode === MODE_MUTED || node.mode === MODE_BYPASS) && !REF_LOADER_TYPES.has(nodeType)) {
      result.skippedNodes.push([nodeId, nodeType, "bypassed/muted in the editor"]); continue;
    }
    if (nodeType === "PrimitiveNode") {
      if (!node._synthetic) result.skippedNodes.push([nodeId, nodeType, "PrimitiveNode - value inlined into the inputs it feeds"]);
      continue;
    }

    const schema = objectInfo[nodeType];
    if (!schema) { result.unknownTypes.push([nodeId, nodeType]); continue; }

    const inputOrder = schema.input_order || {};
    let namesInOrder: string[] = [...(inputOrder.required || []), ...(inputOrder.optional || [])];
    const inputDefs: Json = { ...((schema.input || {}).required || {}), ...((schema.input || {}).optional || {}) };
    if (!namesInOrder.length) namesInOrder = Object.keys(inputDefs);

    const linked: Record<string, any> = {};
    for (const slot of node.inputs || []) {
      if (slot.link == null) continue;
      const link = linksById.get(slot.link);
      if (!link) continue;
      const resolved = resolveLink(link, passthrough, primitives);
      if (resolved) linked[slot.name] = resolved[1];
    }

    const widgetsValues = node.widgets_values || [];
    const values: any[] | null = Array.isArray(widgetsValues) ? widgetsValues : null;
    const widgetDict: Json | null = !Array.isArray(widgetsValues) && widgetsValues && typeof widgetsValues === "object" ? widgetsValues : null;
    const requiredNames = new Set(Object.keys((schema.input || {}).required || {}));
    let pos = 0;

    const inputs: Record<string, any> = {};
    for (const name of namesInOrder) {
      const spec = inputDefs[name];
      if (spec === undefined) { if (name in linked) inputs[name] = linked[name]; continue; }

      const typeTag = spec && spec.length ? spec[0] : null;
      const options: Json = spec && spec.length > 1 && spec[1] && typeof spec[1] === "object" && !Array.isArray(spec[1]) ? spec[1] : {};
      if (typeof typeTag === "string" && typeTag.startsWith("COMFY_AUTOGROW")) continue; // dynamic slots are added from `linked` below
      const isWidget = Array.isArray(typeTag) || (typeof typeTag === "string" && (WIDGET_TYPES.has(typeTag) || typeTag.startsWith("COMFY_")));

      // widgets_values holds EVERY widget positionally, including ones whose socket is currently wired to a link,
      // so the value must be consumed either way or all later widgets misalign.
      let hasValue = false, value: any = null;
      if (isWidget) {
        if (widgetDict) { hasValue = name in widgetDict; value = widgetDict[name]; }
        else if (values && pos < values.length && fits(typeTag, values[pos])) {
          value = values[pos]; hasValue = true; pos++;
          // The companion "control after generate" entry isn't a real input - skip it or every later widget shifts.
          if (pos < values.length && (options.control_after_generate || (SEED_INPUTS.has(name) && CONTROL_MODES.includes(values[pos])))) pos++;
        }
      }

      // A workflow saved by an older node version has fewer widget values than the schema now has; the editor
      // fills the gap with the widget's default, and so must this.
      if (isWidget && !hasValue && !(name in linked) && requiredNames.has(name)) {
        const choices = Array.isArray(typeTag) ? typeTag : options.options;
        if ("default" in options) { value = options.default; hasValue = true; }
        else if (choices && choices.length) { value = choices[0]; hasValue = true; }
      }

      if (name in linked) inputs[name] = linked[name];
      else if (hasValue) inputs[name] = value;
    }
    // Dynamic slots (e.g. "values.a" on an autogrow node) aren't in the schema's fixed list; keep any link not placed above.
    for (const [name, value] of Object.entries(linked)) if (!(name in inputs)) inputs[name] = value;

    const title = node.title || (node.properties || {})["Node name for S&R"] || nodeType;
    result.apiWorkflow[nodeId] = { class_type: nodeType, inputs, _meta: { title } };
  }

  // Report any input pointing at a node we skipped/dropped, rather than silently shipping a graph ComfyUI will reject.
  for (const [nodeId, node] of Object.entries<any>(result.apiWorkflow)) {
    for (const [inputName, value] of Object.entries<any>(node.inputs)) {
      if (isLinkValue(value) && !(value[0] in result.apiWorkflow)) result.danglingLinks.push([nodeId, inputName, value[0]]);
    }
  }
  result.ok = result.unknownTypes.length === 0 && result.danglingLinks.length === 0;
  return result;
}
