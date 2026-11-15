---
id: pi-learn-aurora
type: module-design
status: draft
title: Aurora UI và tài nguyên theme
references: [pi-learn-chatgpt-usage]
source-paths: [packages/pi-learn-extensions/extensions/aurora-ui.ts, packages/pi-learn-extensions/extensions/aurora/, packages/pi-learn-extensions/themes/midnight-aurora.json, packages/pi-learn-extensions/tests/aurora/, packages/pi-learn-extensions/tests/navigation/, packages/pi-learn-extensions/tests/theme/]
---

# Aurora UI và tài nguyên theme

## Trách nhiệm và ranh giới

`packages/pi-learn-extensions/extensions/aurora-ui.ts` đăng ký presentation layer của Pi: editor/footer/banner, badges, theme picker, sidebar và cây phiên. Helpers trong `extensions/aurora/` chỉ được entrypoint này import, không auto-load riêng; lựa chọn này tránh đăng ký UI hai lần theo README package.

Aurora không sở hữu credential hay fetch usage; nó đọc contract tùy chọn của [module usage](../chatgpt-usage/SPEC.md). Host Pi sở hữu session tree, theme registry và terminal lifecycle. `packages/pi-learn-extensions/themes/midnight-aurora.json` là resource độc lập do manifest expose, không phải theme được Aurora tự bật.

## Contracts và thay đổi an toàn

[Catalog Aurora](../../extensions/catalog.md#aurora-ui) giữ contract render/lifecycle và [catalog theme](../../extensions/catalog.md#midnight-aurora-theme) giữ palette/contrast. Các boundary cần đi qua khi sửa:

| Thay đổi | Đường kiểm tra |
|---|---|
| Footer/editor/badges | `aurora-ui.ts`: render → host layout/width → footer dispose; giữ autocomplete, hasUI guards và [shared usage fields](../../extensions/catalog.md#contract-dùng-chung-với-aurora) |
| Sidebar | `packages/pi-learn-extensions/extensions/aurora/sidebar.ts` → `navigation.ts`/`layout.ts`: chỉ thay viewport, không đổi leaf |
| `/tree-v2` | `packages/pi-learn-extensions/extensions/aurora/tree-command.ts` → host `ctx.navigateTree()`: có thể đổi vị trí session; sample/Space/click không thay thế Enter navigation |
| Theme | Resource JSON → registry host → semantic tokens mỗi render; không ghi lựa chọn theme hoặc đổi nền terminal |

[Navigation guide trong catalog](../../extensions/catalog.md#sidebar-và-cây-phiên-v2) dẫn tới README source sở hữu phím, summary/cancel và private-layout limitations. Đừng suy từ sidebar “chỉ cuộn” rằng tree cũng chỉ là viewer. Các tiêu đề tool của tree không phải cơ chế che bí mật tổng quát.

## Validation và giới hạn

`packages/pi-learn-extensions/tests/aurora/aurora-ui.test.mjs` dùng host doubles; `tests/navigation/` và `tests/theme/` trong cùng package kiểm navigation/contrast theo [testing guide](../../operations/testing-and-safety.md#automated-tests). Navigation suite chạy riêng, không nằm trong `npm test`; PTY smoke cũng là command riêng.

Layout adapter phụ thuộc private Pi 1.5.0 shapes; footer subscription phụ thuộc host gọi dispose. Vì vậy test màu hoặc registration không đủ chứng minh lifecycle hoạt động trên mọi Pi/terminal. Chưa xác minh PTY, `/reload` tương tác, host theme schema hoặc màu terminal thực trong lượt init này. Các giới hạn cụ thể thuộc catalog, không được biến reviewed constraint thành khẳng định đã test thành công.
