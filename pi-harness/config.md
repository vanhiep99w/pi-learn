# Pi Harness Config

> Chi tiết hóa phần config trong [`plan.md`](./plan.md).
>
> Mục tiêu: định nghĩa nơi lưu config, precedence, ý nghĩa từng field, policy an toàn, và config mở rộng sau MVP.

---

## 7. Config mặc định

Config dùng để điều khiển runtime scan/normalize/report/propose/apply. Config không chứa secrets.

### 7.1 Vị trí config

Có 2 loại config:

```txt
~/.pi/harness/config.json              # global/user defaults, private
<project>/harness/config.json          # project config, có thể commit nếu đã review
```

Precedence khuyến nghị:

```txt
CLI flags > project config > global config > built-in defaults
```

Ví dụ:

```bash
harness report --project /home/hieptran/Desktop/pi-learn --last 5
```

`--project` override `projectCwd` trong config.

### 7.2 MVP config tối thiểu

File project nếu dùng trong repo:

```txt
harness/config.json
```

Ví dụ tối thiểu:

```json
{
  "schemaVersion": 1,
  "sessionDir": "~/.pi/agent/sessions",
  "harnessHome": "~/.pi/harness",
  "projectCwd": "/home/hieptran/Desktop/pi-learn",
  "redact": true,
  "maxSessionsPerScan": 50,
  "activePathOnly": true,
  "autoApply": false,
  "autoPush": false,
  "targets": {
    "agents": true,
    "memory": true,
    "rules": true,
    "skills": true,
    "prompts": true,
    "extensions": true,
    "parser": true,
    "redaction": true,
    "settings": false
  },
  "riskPolicy": {
    "lowRiskAutoPatch": false,
    "requireHumanApproval": true,
    "requireGitClean": true
  }
}
```

### 7.3 Ý nghĩa từng field

| Field | Type | Default | Ý nghĩa |
|---|---|---|---|
| `schemaVersion` | number | `1` | Version schema của config để migrate sau này. |
| `sessionDir` | string | `~/.pi/agent/sessions` | Nơi Pi lưu raw session JSONL. Runtime chỉ đọc read-only. |
| `harnessHome` | string | `~/.pi/harness` | Nơi lưu private normalized cache/reports/proposals draft. Không commit. |
| `projectCwd` | string | current cwd | Project mặc định để scan/report/propose. Nên resolve thành realpath/git root. |
| `redact` | boolean | `true` | Bật redaction secrets trước khi ghi cache/report hoặc gửi LLM. Nên luôn true. |
| `maxSessionsPerScan` | number | `50` | Giới hạn số session gần nhất mỗi lần scan để MVP nhanh và an toàn. |
| `activePathOnly` | boolean | `true` | Chỉ tính events trên active branch/path mặc định. Tránh lấy lỗi từ branch đã bỏ. |
| `autoApply` | boolean | `false` | Cho phép tự apply proposal hay không. MVP bắt buộc false. |
| `autoPush` | boolean | `false` | Cho phép tự push git hay không. Luôn nên false trừ khi có policy riêng rất rõ. |
| `targets` | object | xem dưới | Artifact nào được phép tạo proposal improve. |
| `riskPolicy` | object | xem dưới | Luật an toàn khi apply patch/proposal. |

### 7.4 `targets`

`targets` quyết định rule/proposal generator được phép đề xuất sửa loại artifact nào.

```json
{
  "targets": {
    "agents": true,
    "memory": true,
    "rules": true,
    "skills": true,
    "prompts": true,
    "extensions": true,
    "parser": true,
    "redaction": true,
    "settings": false
  }
}
```

Ý nghĩa:

| Target | Khi bật thì harness được propose gì? | Risk |
|---|---|---|
| `agents` | Sửa `AGENTS.md`/instruction project. | medium |
| `memory` | Thêm/sửa curated memory trong `harness/memory/`. | low-medium |
| `rules` | Thêm/sửa reviewed Markdown prompt guidance trong existing `wiki/**/_rules.md`. Detector implementation/default changes target runtime code/tests, không phải Wiki config. | medium |
| `skills` | Tạo/update skill workflow. | medium |
| `prompts` | Tạo/sửa prompt templates/model prompts. | medium |
| `extensions` | Sửa Pi extension/tools/TUI code. | high |
| `parser` | Sửa parser/normalizer session JSONL. | medium-high |
| `redaction` | Sửa redaction/sensitive path policy. | high |
| `settings` | Sửa settings/provider/model defaults. | high, mặc định false |

Quan trọng: `targets.* = true` chỉ cho phép **tạo proposal**, không có nghĩa là tự apply.

### 7.5 `riskPolicy`

```json
{
  "riskPolicy": {
    "lowRiskAutoPatch": false,
    "requireHumanApproval": true,
    "requireGitClean": true
  }
}
```

Ý nghĩa:

| Field | Default | Ý nghĩa |
|---|---:|---|
| `lowRiskAutoPatch` | `false` | Nếu true, runtime có thể draft/apply patch low-risk theo policy. MVP để false. |
| `requireHumanApproval` | `true` | Proposal phải được user approve trước khi apply. |
| `requireGitClean` | `true` | Trước khi apply, working tree phải clean hoặc user xác nhận rõ. |

Recommended MVP:

```txt
autoApply=false
autoPush=false
riskPolicy.lowRiskAutoPatch=false
riskPolicy.requireHumanApproval=true
riskPolicy.requireGitClean=true
```

### 7.6 Config đầy đủ hơn sau MVP

Sau MVP có thể mở rộng:

```json
{
  "schemaVersion": 1,
  "sessionDir": "~/.pi/agent/sessions",
  "harnessHome": "~/.pi/harness",
  "projectCwd": "/home/hieptran/Desktop/pi-learn",
  "projectKeyStrategy": "basename-plus-path-hash",
  "redact": true,
  "activePathOnly": true,
  "maxSessionsPerScan": 50,
  "cache": {
    "enabled": true,
    "useMtimeSize": true,
    "computeRawHash": false,
    "atomicWrites": true
  },
  "truncation": {
    "messageExcerptChars": 1000,
    "assistantExcerptChars": 1500,
    "toolResultExcerptChars": 2000,
    "bashOutputHeadChars": 1000,
    "bashOutputTailChars": 3000,
    "maxErrorLines": 50,
    "argsPreviewChars": 300
  },
  "redaction": {
    "secretPatterns": ["openai", "github", "tavily", "authorization", "oauth"],
    "sensitivePaths": [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "~/.pi/agent/auth.json",
      "~/.pi/agent/chatgpt-usage-accounts.json",
      ".pi/logs/llm-payloads/**"
    ]
  },
  "reports": {
    "writeLatest": true,
    "includeInactiveBranches": false,
    "includeWarnings": true
  },
  "proposals": {
    "dedupe": true,
    "minEvidenceCount": 2,
    "draftDir": "proposals/draft"
  },
  "llm": {
    "enabled": false,
    "maxExcerptChars": 12000,
    "requireRedaction": true
  },
  "targets": {
    "agents": true,
    "memory": true,
    "rules": true,
    "skills": true,
    "prompts": true,
    "extensions": true,
    "parser": true,
    "redaction": true,
    "settings": false
  },
  "riskPolicy": {
    "lowRiskAutoPatch": false,
    "requireHumanApproval": true,
    "requireGitClean": true,
    "allowAutoCommit": false,
    "allowAutoPush": false
  }
}
```

Nhóm mở rộng:

| Nhóm | Ý nghĩa |
|---|---|
| `cache` | Cách kiểm tra session raw có đổi chưa và cách ghi cache. |
| `truncation` | Giới hạn excerpt/head/tail để không lưu output quá dài. |
| `redaction` | Pattern secrets và sensitive paths. |
| `reports` | Report có include warnings/inactive branches không. |
| `proposals` | Dedupe proposal và yêu cầu evidence tối thiểu. |
| `llm` | Có bật LLM reflection không, và chỉ dùng dữ liệu đã redact. |

### 7.7 Config policy

Bắt buộc:

```txt
redact=true
autoPush=false
requireHumanApproval=true
```

Không nên commit config chứa:

```txt
absolute private path nhạy cảm
API keys
tokens
auth file contents
raw session file paths nếu report public
```

Với repo public, chỉ commit config generic hoặc project-safe. User-specific override nên để ở:

```txt
~/.pi/harness/config.json
```

