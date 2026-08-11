import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { redactSensitiveText } from "./errors.ts";
import { runImageGen, selectDispatcherModel } from "./orchestrator.ts";
import { imageGenSchema, type ImageGenInput } from "./schema.ts";

export default function imageGenExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "image_gen",
    label: "Image Gen",
    description: "Generate or reference-edit images with the experimental ChatGPT/Codex subscription backend. Saves non-destructively, validates output, writes a metadata sidecar, and returns images inline. Public API fallback, masks, and transparency are not implemented yet and fail without billing.",
    promptSnippet: "Generate or reference-edit image assets and save them in the workspace",
    promptGuidelines: [
      "Use image_gen when the user asks to create or edit an image asset.",
      "When an image_gen result will be referenced by source code, pass a project-relative outputPath so the asset is saved in the workspace.",
      "For image_gen edits, assign every input image an explicit role and use edit_target only for the image to modify.",
    ],
    parameters: imageGenSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        return await runImageGen(params as ImageGenInput, signal, ctx, (message) => {
          onUpdate?.({ content: [{ type: "text", text: message }], details: { phase: "generation" } });
        });
      } catch (error) {
        // Do not retain the raw error as `cause`: provider errors may contain credentials or data URLs.
        throw new Error(redactSensitiveText(error));
      }
    },
  });

  pi.registerCommand("image-gen", {
    description: "Image generation: /image-gen generate <prompt> | /image-gen doctor",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const space = trimmed.indexOf(" ");
      const action = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
      const rest = space < 0 ? "" : trimmed.slice(space + 1).trim();

      if (!action || action === "doctor") {
        const report = await doctor(ctx);
        emitCommandText(ctx, report);
        return;
      }
      if (action !== "generate") {
        emitCommandText(ctx, "Usage: /image-gen generate <prompt> | /image-gen doctor", "warning");
        return;
      }
      if (!rest) {
        emitCommandText(ctx, "Missing prompt. Usage: /image-gen generate <prompt>", "warning");
        return;
      }

      try {
        emitCommandText(ctx, "Generating image with ChatGPT/Codex subscription…");
        const result = await runImageGen({ prompt: rest }, undefined, ctx);
        emitCommandText(ctx, result.content[0]?.type === "text" ? result.content[0].text : "Image generated.");
      } catch (error) {
        emitCommandText(ctx, `Image generation failed: ${redactSensitiveText(error)}`, "error");
      }
    },
  });
}

async function doctor(ctx: ExtensionContext): Promise<string> {
  let subscriptionAuth = false;
  try {
    subscriptionAuth = Boolean((await ctx.modelRegistry.getProviderAuth("openai-codex"))?.auth.apiKey);
  } catch {
    subscriptionAuth = false;
  }

  let apiAuth = false;
  try {
    apiAuth = Boolean((await ctx.modelRegistry.getProviderAuth("openai"))?.auth.apiKey);
  } catch {
    apiAuth = false;
  }

  let dispatcher = "unavailable";
  try {
    dispatcher = selectDispatcherModel(ctx, false);
  } catch {
    // The report remains non-sensitive and explains the unavailable state.
  }

  return [
    "Pi Image Gen (experimental, initial implementation)",
    `Subscription auth available: ${subscriptionAuth ? "yes" : "no"}`,
    `Public API auth available: ${apiAuth ? "yes" : "no"}`,
    `Selected dispatcher model: ${dispatcher}`,
    "Image model: gpt-image-2",
    "Implemented: subscription generate, references, reference-conditioned edit, small variants, output validation, sidecar metadata",
    "Pending: public API fallback, masks, native/chroma-key transparency, batch command",
    "Paid fallback can never run in this build.",
  ].join("\n");
}

function emitCommandText(
  ctx: ExtensionContext,
  text: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) ctx.ui?.notify(text, level);
  else console.log(text);
}
