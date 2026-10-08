# Architecture rules

Apply these rules when editing package manifests, public package boundaries, or architecture documentation under `wiki/architecture/`.

## ARCH-BOUNDARY-001 — Keep the public package self-contained

Public runtime source belongs under `packages/pi-learn-extensions/`. Do not add imports from removed/private sibling runtime packages. Keep root and package-level Pi manifests aligned with the actual extension/theme directories.

## ARCH-SCOPE-001 — Keep the reduced package scope explicit

The supported package surface is the repository Wiki, ChatGPT usage status, Aurora UI, and the Midnight Aurora theme. Do not reintroduce retired session-observability, proposal/eval/apply, image-generation, or model-prompt tooling without an explicit user request.
