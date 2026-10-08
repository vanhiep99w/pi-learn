import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWikiCommands } from "./wiki-commands.js";

export default function wikiExtension(pi: ExtensionAPI) {
  registerWikiCommands(pi);
}
