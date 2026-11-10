import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWikiCommands } from "./wiki-commands.js";
import { registerWikiReadTools } from "./wiki-tools.ts";
import { registerWikiMutationTools } from "./wiki-mutation-tools.ts";

export default function wikiExtension(pi: ExtensionAPI) {
  const access = registerWikiCommands(pi);
  registerWikiReadTools(pi);
  registerWikiMutationTools(pi, access);
}
