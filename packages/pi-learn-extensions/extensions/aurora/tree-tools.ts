/** Title-only tool calls. Keep result flags, never retain output bodies. */

type Call = { id: string; name: string; arguments: Record<string, unknown> };
export function toolTarget(call: Call): string {
  const args = call.arguments ?? {};
  const path = args.path ?? args.file_path ?? args.filePath;
  if (typeof path === "string") return path.slice(0, 240);
  if ((call.name === "bash" || call.name === "powershell") && typeof args.command === "string") {
    const first = args.command.split("\n")[0];
    return first.slice(0, 160) + (args.command.includes("\n") || first.length > 160 ? " …" : "");
  }
  if (call.name === "codemode") return "JavaScript · đã ẩn nội dung script";
  return "Đã ẩn đối số";
}
