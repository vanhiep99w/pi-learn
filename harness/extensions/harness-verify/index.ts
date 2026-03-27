import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Protected Paths ──

const PROTECTED_PATHS = [
  ".env",
  ".beads/",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+[\/~]/,     // rm -rf /... or ~/...
  /DROP\s+TABLE/i,
  /DROP\s+DATABASE/i,
  /format\s+[a-z]:/i,
  />\s*\/dev\/sd[a-z]/,
];

function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((p) => path.includes(p));
}

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(cmd));
}

// ── Extension Entry Point ──

export default function (pi: ExtensionAPI) {

  // ═══════════════════════════════════════════════════════
  // 1. PERMISSION GATES — Block edits to protected paths
  // ═══════════════════════════════════════════════════════

  pi.on("tool_call", async (event: any) => {
    // Gate: Protected file paths
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = event.input?.path || event.input?.file_path || "";

      if (isProtectedPath(path)) {
        pi.ctx?.ui?.notify(
          `🛡️ Blocked: ${path} is protected`,
          3000
        );
        return {
          block: true,
          reason: `Protected path: ${path}. This file should not be modified by agents.`,
        };
      }
    }

    // Gate: Dangerous bash commands
    if (event.toolName === "bash") {
      const cmd = event.input?.command || "";
      if (isDangerousCommand(cmd)) {
        pi.ctx?.ui?.notify(
          `⚠️ Dangerous command blocked: ${cmd.slice(0, 50)}...`,
          5000
        );
        return {
          block: true,
          reason: `Dangerous command blocked: "${cmd}". This could cause data loss.`,
        };
      }
    }
  });

  // ═══════════════════════════════════════════════════════
  // 2. BACK-PRESSURE — Auto-verify after file edits
  // ═══════════════════════════════════════════════════════

  pi.on("tool_result", async (event: any) => {
    // Only verify after file modifications
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return;
    }

    const filePath = event.input?.path || event.input?.file_path || "";

    // Skip non-TypeScript/JavaScript files
    if (
      !filePath.endsWith(".ts") &&
      !filePath.endsWith(".tsx") &&
      !filePath.endsWith(".js") &&
      !filePath.endsWith(".jsx")
    ) {
      return;
    }

    try {
      // Tier 1: TypeScript check
      const tsc = await pi.exec("npx", ["tsc", "--noEmit"], {
        timeout: 15000,
      });

      if (tsc.code !== 0) {
        // Surface errors — append to tool result
        const errors = (tsc.stderr || tsc.stdout || "")
          .split("\n")
          .filter((l: string) => l.includes("error TS"))
          .slice(0, 10) // Max 10 errors to avoid context bloat
          .join("\n");

        if (errors) {
          return {
            content: [
              ...(event.content || []),
              {
                type: "text" as const,
                text: `\n⚠️ TypeScript errors after edit:\n${errors}`,
              },
            ],
          };
        }
      }
      // Success → swallow (return nothing = no modification to result)
    } catch {
      // tsc not available → skip silently
    }
  });

  // ═══════════════════════════════════════════════════════
  // 3. STARTUP
  // ═══════════════════════════════════════════════════════

  pi.on("session_start", () => {
    pi.ctx?.ui?.notify(
      `🛡️ Harness Verify: permission gates + back-pressure active`,
      2000
    );
  });
}
