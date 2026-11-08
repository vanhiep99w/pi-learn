"""Bundled Pi PTY smoke test. Requires pi + pexpect; only synthetic session data."""
import json
import os
import re
from pathlib import Path
import tempfile
import uuid

import pexpect

extension = os.environ.get("PI_NAV_EXTENSION") or str(Path(__file__).resolve().parents[2] / "extensions" / "aurora-ui.ts")
theme_args = ["--use-theme", os.environ["PI_NAV_THEME"]] if os.environ.get("PI_NAV_THEME") else []
with tempfile.TemporaryDirectory(prefix="pi-prompt-nav-") as home:
    session = Path(home) / "synthetic.jsonl"
    stamp = "2026-01-01T00:00:00.000Z"
    entries = [{"type": "session", "version": 3, "id": str(uuid.uuid4()), "timestamp": stamp, "cwd": home}]
    parent = None
    for i in range(1, 13):
        for role, text in [
            ("user", f"PROMPT_{i:02}: kiểm tra Unicode và điều hướng"),
            ("assistant", ("GLYPH_10 ☰ WIDTH_TEST\n\n" if i == 10 else "") + "\n\n".join(f"ANSWER_{i:02} paragraph {j:02}. Synthetic fixture text only." for j in range(35))),
        ]:
            ident = f"{len(entries):08x}"
            msg = {"role": role, "content": [{"type": "text", "text": text}], "timestamp": 1767225600000 + len(entries)}
            if role == "assistant":
                msg.update(api="openai-completions", provider="openai", model="gpt-4o", stopReason="stop", usage={
                    "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
                    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0},
                })
            entries.append({"type": "message", "id": ident, "parentId": parent, "timestamp": stamp, "message": msg})
            parent = ident
    session.write_text("".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries), encoding="utf-8")
    # Explicit allowlist: do not inherit API keys, user HOME, Pi configs, or logging.
    env = {
        "PATH": os.environ["PATH"], "HOME": home, "LANG": "C.UTF-8", "TERM": "xterm-256color",
        "PI_CODING_AGENT_DIR": home + "/agent", "PI_OFFLINE": "1", "PI_TELEMETRY": "0",
        "VTE_VERSION": "8400",  # Exercise the scoped, reversible width guard.
    }
    child = pexpect.spawn("pi", [
        "--session", str(session), "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-themes", "--no-tools", "--tui-mode", "fullscreen", *theme_args, "-e", extension,
    ], cwd=home, env=env, dimensions=(24, 110), encoding="utf-8", timeout=15)

    def click(x, y):
        child.send(f"\x1b[<0;{x};{y}M")
        child.send(f"\x1b[<0;{x};{y}m")

    def button_row():
        positions = list(re.finditer(r"\x1b\[(\d+);(\d+)H", child.before))
        assert positions, "button row must be painted by the real renderer"
        return int(positions[-1].group(1))

    def wait_button():
        child.expect_exact("≡")
        return button_row()

    def wait_open():
        # A list row may arrive before or after the native above-editor widget.
        row, listed = None, False
        while row is None or not listed:
            match = child.expect_exact(["≡", "1. PROMPT_01"])
            if match == 0:
                row = button_row()
            else:
                listed = True
        return row

    try:
        row = wait_button()
        # Offline startup can paint the widget before the no-model warning and
        # initial compositor attachment have settled. Don't click that first frame.
        child.expect(pexpect.TIMEOUT, timeout=0.5)
        assert 1 < row < 24, "button belongs above the editor, not on the bottom screen row"
        click(109, row)
        close_row = wait_open()
        assert 1 < close_row < 24
        click(76, close_row)  # Open right sidebar: button follows main input width 77.
        row = wait_button()
        click(109, row)
        close_row = wait_open()
        click(80, 1)
        child.expect("ANSWER_01")
        click(80, 2)
        child.expect("ANSWER_02")
        child.send("/sidebar goto 3\r")
        child.expect("ANSWER_03")
        child.setwinsize(30, 90)
        close_row = wait_button()
        assert 1 < close_row < 30, "button tracks the editor after resize"
        child.send("/sidebar goto 5\r")
        child.expect("ANSWER_05")
        child.send("/sidebar goto 10\r")
        child.expect_exact("☰  WIDTH_TEST")  # One extra DISPLAY cell, not a session edit.
        child.expect("ANSWER_10")
        child.send("/sidebar goto 11\r")
        child.expect("ANSWER_11")
        child.send("/sidebar left\r")
        close_row = wait_button()
        click(2, 4)
        child.expect("ANSWER_04")
        child.send("/sidebar bottom\r")
        child.expect("ANSWER_12")
        child.expect(pexpect.TIMEOUT, timeout=0.3)
        child.expect(r"(?s).*")
        click(89, close_row)
        row = wait_button()
        click(89, row)
        close_row = wait_open()
        click(2, 4)
        child.expect("ANSWER_04")
        child.expect(pexpect.TIMEOUT, timeout=0.3)
        child.expect(r"(?s).*")
        child.send("/reload\r")
        row = wait_button()
        click(89, row)
        close_row = wait_open()
        click(60, 1)
        child.expect("ANSWER_01")
        click(56, close_row)  # Reload resets to right; main input is now 57 columns.
        wait_button()
        child.sendcontrol("d")
        child.expect(pexpect.EOF)
        after = [json.loads(line) for line in session.read_text(encoding="utf-8").splitlines()]
        assert [e["id"] for e in after if e["type"] == "message"] == [e["id"] for e in entries if e["type"] == "message"]
        print("PASS: above-input toggle on both sides, resize/reload, goto 10/11 and VTE display padding; message IDs unchanged.")
    finally:
        child.close(force=True)
