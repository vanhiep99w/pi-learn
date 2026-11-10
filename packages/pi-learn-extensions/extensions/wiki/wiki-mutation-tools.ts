// SPDX-License-Identifier: Apache-2.0
// Adapted from ThinkRail spec-graph create/update adapters; see vendor/thinkrail-spec-graph/ORIGIN.json.
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { WIKI_SOURCE_PATHS_FIELD } from "./wiki-source-paths.js";
import { WikiModelError } from "./wiki-model.ts";
import type { WikiWriteAccess } from "./wiki-commands.ts";
import { DURABLE_SPEC_TYPES, WIKI_LIST_FIELDS, WikiSpecWriter } from "./wiki-spec-writer.ts";
import { wikiReadResult } from "./wiki-tools.ts";

const text = () => Type.String({ minLength: 1, maxLength: 256 });
const values = () => Type.Array(text(), { maxItems: 200 });
const enumString = <T extends readonly string[]>(items: T) => Type.Unsafe<T[number]>({ type: "string", enum: [...items] });
const sourcePaths = () => Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 200, description: "Unique literal project-relative files or trailing-/ directory scopes; no globs/traversal. Routing metadata only, never reads or grants access to source." });
const lists = Type.Object(Object.fromEntries(WIKI_LIST_FIELDS.map((field) => [field, Type.Optional(field === WIKI_SOURCE_PATHS_FIELD ? sourcePaths() : values())])), { additionalProperties: false });

export const wikiSpecCreateParameters = Type.Object({
  path: Type.String({ minLength: 1, description: "New Wiki-relative .md file, e.g. modules/usage/SPEC.md. Never overwrites or converts a guide." }),
  id: text(), type: enumString(DURABLE_SPEC_TYPES), title: text(),
  parent: Type.Optional(text()), dependsOn: Type.Optional(values()), references: Type.Optional(values()),
  implements: Type.Optional(values()), covers: Type.Optional(values()), tags: Type.Optional(values()), sourcePaths: Type.Optional(sourcePaths()),
}, { additionalProperties: false });

export const wikiSpecUpdateParameters = Type.Object({
  id: text(),
  expectedRevision: Type.String({ pattern: "^[a-f0-9]{64}$", description: "Document revision from wiki_get data.revision (not output.revision). Required to avoid overwriting concurrent edits." }),
  set: Type.Optional(Type.Object({
    title: Type.Optional(text()), type: Type.Optional(enumString(DURABLE_SPEC_TYPES)), parent: Type.Optional(text()),
    status: Type.Optional(enumString(["draft", "stale", "deprecated"] as const)),
  }, { additionalProperties: false })),
  remove: Type.Optional(Type.Array(enumString(["parent", ...WIKI_LIST_FIELDS] as const), { maxItems: 20 })),
  addList: Type.Optional(lists), removeList: Type.Optional(lists),
}, { additionalProperties: false });

export function registerWikiMutationTools(pi: ExtensionAPI, access: WikiWriteAccess) {
  const writer = new WikiSpecWriter({ queue: withFileMutationQueue });
  let active = false;
  pi.on("session_start", () => { active = true; });
  pi.on("session_shutdown", () => { active = false; });
  function register<T extends TSchema>(name: string, parameters: T, description: string, operation: (cwd: string, params: Static<T>, check: () => void, signal?: AbortSignal) => Promise<unknown>) {
    pi.registerTool({
      name, label: name.replace(/_/gu, " "), parameters, executionMode: "sequential",
      description: `${description} Requires the same active /wiki or /wiki-update run and cwd. Normal built-in edit/write permissions are unchanged. Rechecks authorization after queue waits; never touches rules/brief/metadata or source. No automatic migration, deletion or review approval. Output is a small receipt, not file content.`,
      promptSnippet: description,
      namespace: { name: "pi-learn-wiki", aliases: ["wiki"], description: "Wiki lookup/validation and controlled spec metadata tools; no migration/deletion." },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      async execute(_callId, params, signal, _onUpdate, ctx) {
        try {
          if (!active) throw new WikiModelError("session_inactive", "Spec mutation tools require an active session.");
          if (signal?.aborted) throw new WikiModelError("cancelled", "Spec mutation cancelled before writing.");
          const permit = access.capture(ctx.cwd);
          const check = () => {
            if (!active) throw new WikiModelError("session_inactive", "Spec mutation session ended while queued.");
            permit();
          };
          const result = await operation(ctx.cwd, params, check, signal);
          return wikiReadResult(result);
        } catch (error) {
          const code = error instanceof WikiModelError ? error.code : "spec_write_failed";
          const message = error instanceof WikiModelError ? error.message : "Spec mutation failed. Inspect the target and validate Wiki before retrying; partial writes are possible on I/O failure.";
          return wikiReadResult({ error: { code, message } }, {}, code);
        }
      },
    });
  }
  register("wiki_spec_create", wikiSpecCreateParameters,
    "wiki_spec_create — exclusively create a new draft spec scaffold inside wiki/, with supported type, unique id and existing relation targets. Fill prose with built-in edit afterward; a scaffold is not completed documentation.",
    (cwd, params, check, signal) => writer.create(cwd, params, check, signal));
  register("wiki_spec_update", wikiSpecUpdateParameters,
    "wiki_spec_update — edit existing spec frontmatter only, preserving prose bytes/comments/unknown nested fields. Requires wiki_get document revision. Stable id is immutable; no active/done promotion or conversion of legacy guides.",
    (cwd, params, check, signal) => writer.update(cwd, params, check, signal));
}
