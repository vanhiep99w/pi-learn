import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Image, Text } from "@earendil-works/pi-tui";
import { redactSensitiveText } from "./errors.ts";
import { runImageGen, selectDispatcherModel, type ImageGenExecutionResult } from "./orchestrator.ts";
import { appendPaseoMarkdownPreviews } from "./paseo.ts";
import { imageGenSchema, type ImageGenInput } from "./schema.ts";

const PREVIEW_WIDGET_ID = "image-gen-preview";

export default function imageGenExtension(pi: ExtensionAPI) {
  let pendingPaseoPreviews: string[] = [];

  pi.registerTool({
    name: "image_gen",
    label: "Image Gen",
    description: "Generate or reference-edit images with the experimental ChatGPT/Codex subscription backend. Saves non-destructively, validates output, writes private metadata under the global Pi directory, and returns images inline. Public API fallback, masks, and transparency are not implemented yet and fail without billing.",
    promptSnippet: "Generate or reference-edit image assets and save them in the workspace",
    promptGuidelines: [
      "Use image_gen when the user asks to create or edit an image asset.",
      "Before calling image_gen for a project asset, inspect the workspace for an existing suitable image directory (for example public/images, assets/images, or src/assets) and pass a project-relative outputPath that follows the project's convention.",
      "If image_gen has no suitable project image directory and the user did not choose one, omit outputPath; image_gen then saves in the current workspace root.",
      "Use size=auto for image_gen unless the user or target layout requires explicit dimensions; the experimental subscription backend can return a different valid size and such mismatches are saved with a warning.",
      "After image_gen succeeds, include every line from details.markdownPreviews verbatim in the final assistant response so Paseo renders workspace images inline; do not respond with only the saved file path.",
      "For image_gen edits, assign every input image an explicit role and use edit_target only for the image to modify.",
    ],
    parameters: imageGenSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await runImageGen(params as ImageGenInput, signal, ctx, (message) => {
          onUpdate?.({ content: [{ type: "text", text: message }], details: { phase: "generation" } });
        });
        pendingPaseoPreviews.push(...result.details.markdownPreviews);
        return result;
      } catch (error) {
        // Do not retain the raw error as `cause`: provider errors may contain credentials or data URLs.
        throw new Error(redactSensitiveText(error));
      }
    },
    renderResult(result, { isPartial, showImages }, theme) {
      const container = new Container();
      const text = result.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      if (text) container.addChild(new Text(theme.fg(isPartial ? "warning" : "success", text), 0, 0));
      if (!isPartial && showImages) addImages(container, result as ImageGenExecutionResult, theme);
      return container;
    },
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || pendingPaseoPreviews.length === 0) return;
    const previews = pendingPaseoPreviews;
    pendingPaseoPreviews = [];
    const message = appendPaseoMarkdownPreviews(event.message, previews);
    if (message !== event.message) return { message };
  });

  pi.on("agent_end", () => {
    pendingPaseoPreviews = [];
  });

  pi.on("session_shutdown", (_event, ctx) => {
    pendingPaseoPreviews = [];
    if (ctx.hasUI) ctx.ui?.setWidget(PREVIEW_WIDGET_ID, undefined);
  });

  pi.registerCommand("image-gen", {
    description: "Image generation: /image-gen generate <prompt> | doctor | hide",
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
      if (action === "hide") {
        clearCommandPreview(ctx);
        emitCommandText(ctx, "Image preview hidden.");
        return;
      }
      if (action !== "generate") {
        emitCommandText(ctx, "Usage: /image-gen generate <prompt> | /image-gen doctor | /image-gen hide", "warning");
        return;
      }
      if (!rest) {
        emitCommandText(ctx, "Missing prompt. Usage: /image-gen generate <prompt>", "warning");
        return;
      }

      try {
        clearCommandPreview(ctx);
        emitCommandText(ctx, "Generating image with ChatGPT/Codex subscription…");
        const result = await runImageGen({ prompt: rest }, undefined, ctx);
        showCommandPreview(ctx, result);
        emitCommandText(ctx, result.content[0]?.type === "text" ? result.content[0].text : "Image generated.");
      } catch (error) {
        emitCommandText(ctx, `Image generation failed: ${redactSensitiveText(error)}`, "error");
      }
    },
  });
}

function showCommandPreview(ctx: ExtensionContext, result: ImageGenExecutionResult): void {
  if (ctx.mode !== "tui" || !ctx.hasUI) return;
  const hasImages = result.content.some((item) => item.type === "image");
  if (!hasImages) return;

  ctx.ui?.setWidget(
    PREVIEW_WIDGET_ID,
    (_tui, theme) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("Generated image preview")), 0, 0));
      addImages(container, result, theme, true);
      container.addChild(new Text(theme.fg("dim", "Run /image-gen hide to close this preview."), 0, 0));
      return container;
    },
    { placement: "aboveEditor" },
  );
}

function clearCommandPreview(ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui?.setWidget(PREVIEW_WIDGET_ID, undefined);
}

function addImages(
  container: Container,
  result: ImageGenExecutionResult,
  theme: Theme,
  showPath = false,
): void {
  const images = result.content.filter(
    (item): item is { type: "image"; data: string; mimeType: string } => item.type === "image",
  );
  images.forEach((image, index) => {
    const savedPath = result.details?.savedPaths?.[index];
    if (showPath && savedPath) container.addChild(new Text(theme.fg("muted", savedPath), 0, 0));
    container.addChild(new Image(
      image.data,
      image.mimeType,
      { fallbackColor: (text) => theme.fg("muted", text) },
      { maxWidthCells: 60, maxHeightCells: 24, filename: savedPath },
    ));
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
    "Implemented: subscription generate, references, reference-conditioned edit, small variants, output validation, private global metadata",
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
