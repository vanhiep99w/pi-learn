# RTK Extension for Pi

Extension này tích hợp [rtk-ai/rtk](https://github.com/rtk-ai/rtk) vào Pi Coding Agent.

RTK là CLI proxy để giảm token output của các lệnh dev thường gặp. Extension này không bundle binary `rtk`; mỗi máy cần cài RTK riêng.

## Cài RTK binary

Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

Đảm bảo `~/.local/bin` có trong `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Kiểm tra:

```bash
rtk --version
rtk gain
```

Nếu extension báo `rtk:missing`, restart Pi hoặc chạy:

```txt
/reload
```

## Extension cung cấp gì?

### Tools

#### `rtk_run`

Chạy command qua RTK.

Ví dụ tool args:

```json
{
  "args": ["git", "status"]
}
```

Tương đương:

```bash
rtk git status
```

#### `rtk_gain`

Xem thống kê tiết kiệm token từ:

```bash
rtk gain
```

Options hỗ trợ:

- `graph`
- `history`
- `daily`
- `all`
- `json`

### Slash commands

```txt
/rtk-status
/rtk-toggle on
/rtk-toggle off
/rtk-toggle status
```

`/rtk-status` kiểm tra RTK binary và chạy `rtk --version`, `rtk gain`.

`/rtk-toggle` bật/tắt auto-rewrite Bash command đơn giản.

## Auto-rewrite trong extension

Extension intercept Bash tool calls và user `!` bash commands. Nếu command đơn giản, nó rewrite:

```bash
git status
```

thành:

```bash
rtk git status
```

Chỉ rewrite khi:

- `autoRewrite = true`
- tìm thấy RTK binary
- command là command đơn, không có shell control syntax
- command nằm trong danh sách hỗ trợ của extension

Extension cố ý không rewrite command chứa:

```txt
newline ; & | < > ` $ ( ) { }
```

Lý do: tránh phá command phức tạp, pipe, redirect, env assignment, subshell, hoặc shell injection.

Với command phức tạp, dùng Bash thường hoặc gọi RTK rõ ràng qua `rtk_run`.

## RTK hook warning

Khi chạy `rtk_run`, có thể thấy:

```txt
[rtk] /!\ No hook installed — run `rtk init -g` for automatic token savings
```

Ý nghĩa:

- RTK binary đã chạy được.
- RTK global hook chưa cài.
- Không phải lỗi của Pi extension.

Pi extension có auto-rewrite riêng, nên `rtk init -g` không bắt buộc cho Pi. Chỉ chạy nếu muốn RTK hook cho agent/tool khác như Claude Code, Copilot, Cursor, v.v.

## Cách RTK xử lý command

RTK có 2 cơ chế chính.

### 1. Rust command chính thức

Các command được khai báo trong Rust `src/main.rs`, ví dụ:

```bash
rtk git status
rtk cargo test
rtk pytest
rtk tsc
rtk docker ps
rtk kubectl pods
```

Các command này xuất hiện trong `rtk --help`.

### 2. TOML fallback filters

RTK còn có filters dạng TOML trong repo upstream:

```txt
src/filters/*.toml
```

Các filter này không nhất thiết xuất hiện trong `rtk --help`. Chúng chạy qua fallback path.

Flow thực tế:

```txt
rtk mvn compile
  ↓
Clap parse không thấy subcommand `mvn`
  ↓
run_fallback()
  ↓
lookup TOML filter bằng command string `mvn compile`
  ↓
match filter, execute command thật `mvn compile`
  ↓
capture stdout/stderr nếu config yêu cầu
  ↓
apply TOML pipeline
  ↓
print output đã lọc
```

Debug filter match:

```bash
RTK_TOML_DEBUG=1 rtk mvn compile
```

Tắt TOML engine:

```bash
RTK_NO_TOML=1 rtk mvn compile
```

## TOML filter lookup priority

Theo source RTK, filter lookup theo thứ tự:

```txt
1. .rtk/filters.toml            project-local, cần trust
2. ~/.config/rtk/filters.toml   user-global
3. built-in filters             src/filters/*.toml embedded lúc build
4. passthrough                  nếu không match
```

Project-local filters cần được trust:

```bash
rtk trust
```

Nếu `.rtk/filters.toml` thay đổi sau khi trust, RTK sẽ yêu cầu trust lại.

## TOML filter pipeline

Một filter TOML có các stage chính:

1. `strip_ansi`
2. `replace`
3. `match_output`
4. `strip_lines_matching` hoặc `keep_lines_matching`
5. `truncate_lines_at`
6. `head_lines` / `tail_lines`
7. `max_lines`
8. `on_empty`

Ví dụ schema đơn giản:

```toml
schema_version = 1

[filters.my-tool]
description = "Compact my-tool output"
match_command = "^my-tool\\b"
strip_ansi = true
strip_lines_matching = ["^noise", "^\\s*$"]
max_lines = 50
on_empty = "my-tool: ok"

[[tests.my-tool]]
name = "strips noise"
input = "noise\nimportant"
expected = "important"
```

## RTK config files

Global config:

```txt
~/.config/rtk/config.toml
```

Tạo file mặc định:

```bash
rtk config --create
```

Xem config:

```bash
rtk config
```

Ví dụ:

```toml
[tracking]
enabled = true
history_days = 90

[display]
colors = true
emoji = true
max_width = 120

[filters]
ignore_dirs = [".git", "node_modules", "target", "__pycache__", ".venv", "vendor"]
ignore_files = ["*.lock", "*.min.js", "*.min.css"]

[tee]
enabled = true
mode = "failures"
max_files = 20

[hooks]
exclude_commands = ["git rebase", "git cherry-pick", "docker exec"]

[telemetry]
enabled = false
```

Custom filters:

```txt
.rtk/filters.toml
~/.config/rtk/filters.toml
```

## Java / Maven / Gradle findings

RTK upstream hiện có một số Java ecosystem filters trong `src/filters`:

```txt
mvn-build.toml
gradle.toml
spring-boot.toml
```

### Maven build filter

Upstream `mvn-build.toml`:

```toml
[filters.mvn-build]
description = "Compact Maven build output"
match_command = "^mvn\\s+(compile|package|clean|install)\\b"
```

Nó match:

```bash
rtk mvn compile
rtk mvn package
rtk mvn clean
rtk mvn install
```

Không match:

```bash
rtk mvn test
rtk mvnw compile
rtk ./mvnw compile
```

Nếu máy chưa cài Maven, sẽ thấy lỗi kiểu:

```txt
[rtk: No such file or directory (os error 2)]
```

Điều này nghĩa là filter đã match nhưng binary `mvn` không tồn tại.

### Maven test

Built-in `mvn-build.toml` hiện không match `mvn test`.

Nên dùng generic test wrapper:

```bash
rtk test mvn test
rtk test ./mvnw test
```

### Spring Boot filter

Upstream `spring-boot.toml` match:

```toml
match_command = "^(mvn\\s+spring-boot:run|java\\s+-jar.*\\.jar|gradle\\s+.*bootRun)"
```

Dùng cho:

```bash
rtk mvn spring-boot:run
rtk java -jar target/app.jar
rtk gradle bootRun
```

Filter giữ lại các dòng quan trọng như:

- `Started ... in ...`
- `Tomcat started on port`
- `ERROR`
- `WARN`
- `Exception`
- `Caused by:`
- `Application run failed`

### Gradle filter

Upstream `gradle.toml` tồn tại, nhưng test thực tế với RTK `0.37.2` trên máy này:

```bash
RTK_TOML_DEBUG=1 rtk gradle test
```

cho kết quả:

```txt
[rtk:toml] looking up filter for: "gradle test" (59 filters loaded)
[rtk:toml] no filter matched — passthrough
```

Regex hiện tại trong upstream:

```toml
match_command = "^(gradle|gradlew|\\./)gradlew?\\b"
```

Regex này có vẻ không match command đơn giản `gradle test` như mong đợi. Vì vậy, với Gradle nên dùng generic wrappers:

```bash
rtk test gradle test
rtk test ./gradlew test
rtk err gradle build
rtk err ./gradlew build
```

### Maven support issue/PR

RTK có issue:

```txt
Feature request: add support for maven #338
```

Và PR:

```txt
feat: add Maven (mvn) command support with 7 subcommands #368
```

PR mô tả support:

```bash
rtk mvn compile
rtk mvn test
rtk mvn package
rtk mvn clean
rtk mvn integration-test
rtk mvn install
rtk mvn dependency:tree
```

Nhưng với RTK `0.37.2` test trên máy này:

```bash
rtk --help | grep -Ei 'mvn|maven|gradle|java'
```

không thấy command chính thức. Maven support hiện chủ yếu là TOML fallback filter `mvn-build.toml`, không phải Rust command đầy đủ như PR mô tả.

## Khuyến nghị mapping cho Pi extension

Không nên rewrite Java/Maven/Gradle theo kiểu chung chung:

```txt
mvn test    -> rtk mvn test       # không an toàn
java ...    -> rtk java ...       # chỉ an toàn với một số pattern như java -jar
```

Nên map theo ngữ cảnh:

```txt
mvn compile          -> rtk mvn compile
mvn package          -> rtk mvn package
mvn clean            -> rtk mvn clean
mvn install          -> rtk mvn install
mvn test             -> rtk test mvn test
./mvnw test          -> rtk test ./mvnw test
mvn spring-boot:run  -> rtk mvn spring-boot:run
java -jar app.jar    -> rtk java -jar app.jar
gradle test          -> rtk test gradle test
./gradlew test       -> rtk test ./gradlew test
gradle build         -> rtk err gradle build
./gradlew build      -> rtk err ./gradlew build
```

Nếu không chắc command có filter hay không, dùng:

```bash
RTK_TOML_DEBUG=1 rtk <command> ...
```

## Commands đã test trên máy này

RTK version:

```txt
rtk 0.37.2
```

RTK binary:

```txt
/home/hieptran/.local/bin/rtk
```

`rtk mvn compile`:

```txt
[rtk:toml] matched filter: 'mvn-build'
[rtk: No such file or directory (os error 2)]
```

Kết luận: filter match, nhưng máy chưa có `mvn`.

`rtk gradle test`:

```txt
[rtk:toml] no filter matched — passthrough
```

Kết luận: Gradle TOML filter upstream không match `gradle test` trên RTK `0.37.2`.

`rtk test gradle --version`:

```txt
OUTPUT (last 5 lines):
  Groovy:       3.0.17
  Ant:          Apache Ant(TM) version 1.10.13 compiled on January 4 2023
  JVM:          21.0.10 (Ubuntu 21.0.10+7-Ubuntu-125.10)
  OS:           Linux 6.17.0-22-generic amd64
```

Kết luận: generic `rtk test` chạy được với Gradle command.

## Sources

- RTK repo: https://github.com/rtk-ai/rtk
- RTK README: https://raw.githubusercontent.com/rtk-ai/rtk/master/README.md
- TOML filter engine: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/core/toml_filter.rs
- Main fallback path: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/main.rs
- Filters README: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/filters/README.md
- Command filters README: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/cmds/README.md
- Maven filter: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/filters/mvn-build.toml
- Gradle filter: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/filters/gradle.toml
- Spring Boot filter: https://raw.githubusercontent.com/rtk-ai/rtk/master/src/filters/spring-boot.toml
- Maven issue #338: https://github.com/rtk-ai/rtk/issues/338
- Maven PR #368: https://github.com/rtk-ai/rtk/pull/368
