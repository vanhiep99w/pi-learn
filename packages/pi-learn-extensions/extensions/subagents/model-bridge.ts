import { InMemoryCredentialStore, type Model, type ModelsApiStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export function availableModels(ctx: ExtensionContext): Model<string>[] {
  const scoped = ctx.scopedModels?.map((entry) => `${entry.model.provider}/${entry.model.id}`);
  return ctx.modelRegistry.getAvailable().filter((model) => model.api !== "pi-virtual"
    && (!scoped?.length || scoped.includes(`${model.provider}/${model.id}`)));
}

/** An opaque request bridge, NOT credential copying. The parent registry owns auth,
 * OAuth refresh, provider registration and request dispatch. No auth/models files are opened here. */
export async function createParentRuntime(ctx: ExtensionContext, isLive: () => boolean): Promise<ModelRuntime> {
  const registry = ctx.modelRegistry;
  const models = availableModels(ctx);
  if (ctx.model && ctx.model.api !== "pi-virtual" && !models.some((model) => model.provider === ctx.model!.provider && model.id === ctx.model!.id)) models.push(ctx.model);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  for (const provider of new Set(models.map((model) => model.provider))) {
    const check = () => { if (!isLive()) throw new Error("Delegating parent session is no longer active"); };
    runtime.registerNativeProvider({
      id: provider, name: `Parent session: ${provider}`,
      auth: { apiKey: { name: "Parent-owned authentication", resolve: async () => { check(); return { auth: {} }; } } },
      getModels: () => models.filter((model) => model.provider === provider),
      stream: (model, context, options) => { check(); return registry.stream<string>(model, context, options as ModelsApiStreamOptions<string>); },
      streamSimple: (model, context, options) => { check(); return registry.streamSimple(model, context, options); },
    });
  }
  return runtime;
}
