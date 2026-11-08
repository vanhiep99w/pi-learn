"""Real Pi PTY: separate user/assistant/thinking/call/result events; isolated HOME."""
import json
import os
from pathlib import Path
import tempfile
import uuid

import pexpect

extension = os.environ.get("PI_NAV_EXTENSION") or str(Path(__file__).resolve().parents[2] / "extensions" / "aurora-ui.ts")
theme_args = ["--use-theme", os.environ["PI_NAV_THEME"]] if os.environ.get("PI_NAV_THEME") else []
with tempfile.TemporaryDirectory(prefix="pi-tree-demo-") as home:
    env = {
        "PATH": os.environ["PATH"], "HOME": home, "LANG": "C.UTF-8", "TERM": "xterm-256color",
        "PI_CODING_AGENT_DIR": home + "/agent", "PI_OFFLINE": "1", "PI_TELEMETRY": "0",
    }
    session = Path(home) / "fixture.jsonl"
    stamp = "2026-01-01T12:34:00Z"
    entries = [{"type": "session", "version": 3, "id": str(uuid.uuid4()), "timestamp": stamp, "cwd": home}]
    def message(ident, parent, role, content, **extra):
        value = {"role": role, "content": [{"type": "text", "text": content}] if isinstance(content, str) else content, "timestamp": 1767270840000, **extra}
        if role == "assistant":
            value.update(api="openai-completions", provider="openai", model="gpt-4o", stopReason=extra.get("stopReason", "stop"), usage={
                "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0},
            })
        entries.append({"type": "message", "id": ident, "parentId": parent, "timestamp": stamp, "message": value})
    message("00000001", None, "user", "REAL_QUESTION_ONE " + "older user text " * 20 + "OLD_USER_DETAIL_END")
    message("00000002", "00000001", "assistant", [
        {"type": "thinking", "thinking": "THINKING_BEGIN " + "synthetic reasoning text " * 20 + "THINKING_END_ONLY_WHEN_OPEN"},
        {"type": "thinking", "thinking": "THINKING_SECOND_SHORT"},
        {"type": "text", "text": "INTRO_TEXT_BEGIN"},
        {"type": "toolCall", "id": "ok", "name": "read", "arguments": {"path": "TOOL_OK_TARGET"}},
        {"type": "toolCall", "id": "fail", "name": "bash", "arguments": {"command": "TOOL_FAIL_TARGET"}},
        {"type": "text", "text": "AFTER_TOOLS_TEXT"},
    ])
    message("00000003", "00000002", "toolResult", "SYNTHETIC_OK_OUTPUT", toolCallId="ok", toolName="read", isError=False)
    message("00000004", "00000003", "toolResult", "SYNTHETIC_ERROR_OUTPUT", toolCallId="fail", toolName="bash", isError=True)
    message("00000005", "00000004", "assistant", "REAL_ANSWER_ONE")
    message("00000006", "00000005", "user", "REAL_ALTERNATIVE")
    message("00000007", "00000006", "assistant", [
        {"type": "thinking", "thinking": "ERROR_THINKING_BEGIN " + "synthetic error reasoning " * 12 + "ERROR_THINKING_END"},
        {"type": "text", "text": "ALTERNATIVE_ANSWER"},
    ], stopReason="error")
    message("00000008", "00000005", "user", "REAL_QUESTION_TWO " + "user detail text " * 20 + "CURRENT_USER_DETAIL_END")
    message("00000009", "00000008", "assistant", "# REAL_ANSWER_TWO\n\nCURRENT_RESPONSE_SNIPPET short readable excerpt.\n\n" + "current response detail " * 12 + "CURRENT_RESPONSE_DETAIL_END")
    session.write_text("".join(json.dumps(entry) + "\n" for entry in entries), encoding="utf-8")
    child = pexpect.spawn("pi", [
        "--session", str(session), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-tools",
        "--tui-mode", "fullscreen", *theme_args, "-e", extension,
    ], cwd=home, env=env, dimensions=(32, 124), encoding="utf-8", timeout=20)
    try:
        child.expect_exact("≡")
        child.send("/tree-v2\r")
        child.expect_exact("Từng sự kiện")
        child.expect_exact("Phiên hiện tại")
        def drain():
            child.expect(pexpect.TIMEOUT, timeout=0.4)
            frame = child.before
            child.expect(r"(?s).*")
            return frame
        def read_match(query):
            child.send("/\x15" + query)
            frame = drain()
            child.send("\x1b")  # Leave search without committing navigation.
            frame += drain()
            child.send(" ")
            return frame
        frame = drain()
        for label in ["user: REAL_QUESTION_ONE", "user: REAL_ALTERNATIVE", "user: REAL_QUESTION_TWO", "assistant: CURRENT_RESPONSE_SNIPPET"]:
            assert label in frame, "show actual questions and the current user's response"
        for hidden in ["thinking ·", "tool call:", "tool:", "INTRO_TEXT_BEGIN", "ALTERNATIVE_ANSWER", "ERROR_THINKING_END", "OLD_USER_DETAIL_END"]:
            assert hidden not in frame, "all older work, including errors, should be collapsed"
        assert "CURRENT_USER_DETAIL_END" in frame, "full current question should be readable"
        assert "CURRENT_RESPONSE_DETAIL_END" not in frame, "current response should show only an inline excerpt"
        assert "assistant: # REAL_ANSWER_TWO" not in frame, "do not duplicate the response in its header"
        assert "user message" not in frame and "12:34" not in frame
        child.send("\x1b[B")
        drain()
        child.send(" ")
        child.expect_exact("CURRENT_RESPONSE_DETAIL_END")
        drain()
        child.send(" ")
        drain()
        child.send("\x1b[H")
        drain()
        child.send(" ")
        frame = drain()
        labels = ["user: REAL_QUESTION_ONE", "thinking · 2 mục", "assistant: INTRO_TEXT_BEGIN",
                  "tool call: read TOOL_OK_TARGET", "tool call: bash TOOL_FAIL_TARGET", "assistant: AFTER_TOOLS_TEXT",
                  "tool: read TOOL_OK_TARGET", "tool: bash TOOL_FAIL_TARGET"]
        positions = [frame.index(label) for label in labels]
        assert positions == sorted(positions), "opening an old question preserves separate event order"
        assert "OLD_USER_DETAIL_END" in frame
        assert "THINKING_END_ONLY_WHEN_OPEN" not in frame and "THINKING_SECOND_SHORT" not in frame
        assert "SYNTHETIC_OK_OUTPUT" not in frame and "SYNTHETIC_ERROR_OUTPUT" not in frame
        read_match("THINKING_BEGIN")
        child.expect_exact("THINKING_END_ONLY_WHEN_OPEN")
        drain()
        read_match("REAL_QUESTION_ONE")
        drain()
        read_match("REAL_ALTERNATIVE")
        child.expect_exact("ERROR_THINKING_END")
        drain()
        child.send("\x7f")
        drain()
        read_match("REAL_ANSWER_ONE")
        child.expect_exact("REAL_ANSWER_ONE")
        drain()
        frame = read_match("tool call: read") + drain()
        assert "tool call: read TOOL_OK_TARGET" in frame
        assert "SYNTHETIC_OK_OUTPUT" not in frame
        frame = read_match("tool: bash") + drain()
        assert "tool: bash TOOL_FAIL_TARGET" in frame
        assert "SYNTHETIC_ERROR_OUTPUT" not in frame
        child.send("\x1b")
        child.expect_exact("≡")
        child.send("/tree-v2 sample\r")
        child.expect_exact("Từng sự kiện")
        child.expect_exact("Dữ liệu mẫu")
        child.send("/NO_MATCH_999")
        child.expect_exact("Không tìm thấy mục nào.")
        child.send("\x15Đã chuyển phần bù\r")
        child.expect_exact("Đã chuyển phần bù")
        child.setwinsize(24, 76)
        child.expect_exact("Từng sự kiện")
        child.send("\x1b")
        child.expect_exact("≡")
        child.send("/reload\r")
        child.expect_exact("≡")
        child.send("/tree-v2\r")
        child.expect_exact("Từng sự kiện")
        child.expect_exact("CURRENT_RESPONSE_SNIPPET")
        assert "CURRENT_RESPONSE_DETAIL_END" not in drain(), "reload should restore the short excerpt"
        child.send("\x1b")
        child.expect_exact("≡")
        # Enter really navigates through the host API, not just a display selection.
        child.setwinsize(32, 124)
        drain()
        child.send("/tree-v2\r")
        child.expect_exact("Từng sự kiện")
        drain()
        child.send("/REAL_ALTERNATIVE\r")
        child.expect_exact("Tóm tắt nhánh đang rời?")
        child.send("\x1b")
        child.expect_exact("Từng sự kiện")
        drain()
        child.send("\r")
        child.expect_exact("Tóm tắt nhánh đang rời?")
        child.send("\r")  # No summary: offline, no model invocation.
        child.expect_exact("Navigated to selected point")
        frame = drain()
        assert "REAL_ALTERNATIVE" in frame, "choosing user should restore its text in the editor"
        child.send("\x15/tree-v2\r")
        child.expect_exact("Từng sự kiện")
        drain()
        child.send("/ALTERNATIVE_ANSWER\r")
        child.expect_exact("Tóm tắt nhánh đang rời?")
        child.send("\r")
        child.expect_exact("Navigated to selected point")
        drain()
        child.send("\x15/tree-v2\r")
        child.expect_exact("Từng sự kiện")
        child.expect_exact("ERROR_THINKING_END")
        drain()
        child.send("/ALTERNATIVE_ANSWER\r")
        child.expect_exact("Đang ở vị trí này.")
        drain()
        child.send("\x15")  # Discard the restored draft; never submit it to a model.
        child.sendcontrol("d")
        child.expect(pexpect.EOF)
        after = [json.loads(line) for line in session.read_text(encoding="utf-8").splitlines()]
        assert [e for e in after if e["type"] == "message"] == [e for e in entries if e["type"] == "message"]
        print("PASS: compact old questions, inline assistant, indent, Space/click details; Enter native user/assistant navigation, summary cancel/no-summary/current-leaf no-op; search/resize/reload; messages unchanged.")
    finally:
        child.close(force=True)
