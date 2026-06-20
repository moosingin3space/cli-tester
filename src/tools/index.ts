import type { RelationSchema } from "@acastos/fact-query";
import type { FactDb } from "../factdb.js";
import { makeRunCliTool } from "./run-cli.js";
import { makeRecordFactTool } from "./record-fact.js";
import { makeQueryFactsTool } from "./query-facts.js";

/**
 * The toolset for the discovery agent. Tools close over the live {@link FactDb}
 * and the target binary, so they are built per run rather than imported as a
 * static array.
 */
export function discoverTools(opts: { db: FactDb; target: string; schema: RelationSchema[] }) {
  return [
    makeRunCliTool(opts.target),
    makeRecordFactTool(opts.db, opts.schema),
    makeQueryFactsTool(opts.db),
  ] as const;
}
