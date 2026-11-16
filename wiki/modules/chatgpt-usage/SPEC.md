---
id: pi-learn-chatgpt-usage
type: module-design
status: draft
title: Usage và tài khoản ChatGPT
source-paths: [packages/pi-learn-extensions/extensions/chatgpt-usage-status/]
---

# Usage và tài khoản ChatGPT

## Trách nhiệm và ranh giới

Module sở hữu commands đăng nhập/chọn/xóa tài khoản, adapter credential, cache usage và producer trạng thái hiển thị. Luồng usage chỉ hoạt động với provider `openai-codex` hoặc `chatgpt`; account commands cần UI nhưng không bị provider gate này. Module không phải bộ đếm token/cost của Pi và không sở hữu footer Aurora.

Source owner là `packages/pi-learn-extensions/extensions/chatgpt-usage-status/index.ts`. [Catalog usage](../../extensions/catalog.md#chatgpt-usage-status) giữ command table và chi tiết OAuth/account/cache; không tách hay chuyển owner đó sang spec này.

## Điểm nối cần giữ khi thay đổi

| Điểm nối | Contract chuẩn và evidence |
|---|---|
| Session/model/agent events → refresh | [Luồng và cache](../../extensions/catalog.md#luồng-usage-và-cache); `fetchUsage()`, `loadChatGptOauth()` trong source owner |
| Credential adapters → saved accounts | [Persistence](../../extensions/catalog.md#account-state-và-persistence); `switchChatGptAccount()`, `removeProviderCredential()`, `readJson()` |
| Snapshot → Aurora render | [Global object](../../extensions/catalog.md#contract-dùng-chung-với-aurora); `setGlobalUsage()` → `getChatGptUsageBadge()` trong `packages/pi-learn-extensions/extensions/aurora-ui.ts` |

Aurora là consumer tùy chọn, không là điều kiện để refresh usage; không có Aurora thì command details vẫn là đường đọc. Graph dùng reference từ [Aurora](../aurora/SPEC.md), không khai báo dependency bắt buộc giữa hai extension độc lập.

## Rủi ro tích hợp và kiểm chứng

Khi sửa account switch hoặc force refresh, phải kiểm tra tương tác cache với request đang pending, không chỉ happy path của credential. Khi sửa field shared object, kiểm cả producer lẫn consumer và đơn vị thời gian; khi sửa adapter, kiểm legacy/runtime API lẫn fallback. [Failure contract](../../extensions/catalog.md#lỗi-và-thay-đổi-an-toàn) và [manual checks](../../operations/testing-and-safety.md#chatgpt-usage-and-aurora) giữ các giới hạn lifecycle, lỗi network, xóa credential và privacy.

Focused lifecycle tests dùng credential/network giả và installed Pi runner guard được mô tả trong [automated tests](../../operations/testing-and-safety.md#automated-tests); chưa kiểm OAuth/network thật. Thứ tự credential/cache là hành vi quan sát được trong source, không phải rationale sản phẩm đã được user xác nhận; endpoint từ xa và mọi host API version chưa được bảo đảm. Không mở live credential stores để nghiên cứu hoặc dùng token thật làm fixture.
