import type { DB } from "../lib/db.ts";
import { resolvers } from "./resolvers.ts";

interface Field {
  name: string;
  args: Record<string, unknown>;
  selection: Field[];
}

function parseArgs(argStr: string, variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < argStr.length) {
    while (i < argStr.length && /[\s,]/.test(argStr[i])) i++;
    if (i >= argStr.length) break;
    let key = "";
    while (i < argStr.length && argStr[i] !== ":") {
      key += argStr[i];
      i++;
    }
    i++;
    while (i < argStr.length && /\s/.test(argStr[i])) i++;
    let val = "";
    while (i < argStr.length && argStr[i] !== "," && argStr[i] !== ")") {
      val += argStr[i];
      i++;
    }
    val = val.trim();
    if (val.startsWith("$")) out[key] = variables[val.slice(1)];
    else if (val.startsWith('"') || val.startsWith("'")) out[key] = val.slice(1, -1);
    else if (val === "true") out[key] = true;
    else if (val === "false") out[key] = false;
    else if (val !== "") out[key] = Number(val);
  }
  return out;
}

function tokenizeSelection(s: string): Field[] {
  const fields: Field[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let name = "";
    while (i < s.length && !/[\s({]/.test(s[i])) {
      name += s[i];
      i++;
    }
    let args: Record<string, unknown> = {};
    if (s[i] === "(") {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") { depth--; if (depth === 0) break; }
      }
      args = parseArgs(s.slice(i + 1, j), {});
      i = j + 1;
    }
    let selection: Field[] = [];
    if (s[i] === "{") {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") { depth--; if (depth === 0) break; }
      }
      selection = tokenizeSelection(s.slice(i + 1, j));
      i = j + 1;
    }
    fields.push({ name, args, selection });
  }
  return fields;
}

function queryBody(query: string): string {
  const first = query.indexOf("{");
  if (first === -1) return query;
  let depth = 0;
  let end = -1;
  for (let k = first; k < query.length; k++) {
    if (query[k] === "{") depth++;
    else if (query[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  return query.slice(first + 1, end);
}

function project(field: Field, value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => project(field, v));
  if (typeof value !== "object") return value;
  if (!field.selection.length) return value;
  const out: Record<string, unknown> = {};
  for (const sub of field.selection) {
    out[sub.name] = project(sub, (value as Record<string, unknown>)[sub.name]);
  }
  return out;
}

export interface GraphQLResult {
  data?: Record<string, unknown>;
  errors?: { message: string }[];
}

export function execLocal(
  query: string,
  variables: Record<string, unknown>,
  ctx: { db: DB; tenantId: string | null },
): Promise<GraphQLResult> {
  const top = tokenizeSelection(queryBody(query));
  const data: Record<string, unknown> = {};
  for (const f of top) {
    const resolver = resolvers[f.name];
    if (!resolver) { data[f.name] = null; continue; }
    const value = resolver({ ...f.args, ...variables }, ctx);
    data[f.name] = project(f, value);
  }
  return Promise.resolve({ data });
}
