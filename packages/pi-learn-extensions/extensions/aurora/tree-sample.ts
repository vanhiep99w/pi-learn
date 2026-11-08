/** Explicit synthetic sample only; never used for live navigation. */
export type Tool = { name: string; target: string; result: string; error?: boolean; state?: "ok" | "error" | "pending" | "unknown" };
export type Turn = {
  id: string;
  parentId: string | null;
  title: string;
  prompt: string;
  answer: string;
  time: string;
  status?: "aborted";
  tools: Tool[];
};
export type TreeRow = { turn: Turn; prefix: string; hidden: number; ancestor: boolean };

export function sampleHistory(): Turn[] {
  const read = (target: string): Tool => ({ name: "read", target, result: "Đã đọc nội dung file." });
  const edit = (target: string): Tool => ({ name: "edit", target, result: "Đã cập nhật phần layout và giữ nguyên nội dung chat." });
  const test = (target: string): Tool => ({ name: "bash", target, result: "PASS · kiểm tra bằng dữ liệu mẫu, không chạy lệnh thật." });
  const turn = (id: string, parentId: string | null, title: string, time: string, prompt: string, answer: string, tools: Tool[] = []): Turn =>
    ({ id, parentId, title, time, prompt, answer, tools });
  return [
    turn("start", null, "Thêm mục lục cho cuộc hội thoại", "12:30", "Tôi muốn có sidebar để tìm lại các prompt cũ mà không phải cuộn cả cuộc hội thoại.",
      "Mình sẽ dùng một cột riêng cho danh sách prompt. Chọn một mục chỉ cuộn tới tin nhắn, không gửi lại prompt và không tạo nhánh mới.", [read("index.ts"), read("layout.ts")]),
    turn("layout", "start", "Chia cột thật, giữ editor native", "12:34", "Sidebar nên nằm bên cạnh cả chat và ô nhập, đừng đè lên nội dung nhé.",
      "Đã tách layout thành hai cột. Transcript và editor vẫn thuộc cùng một cột chính; sidebar có vùng cuộn riêng.\n\nKhi terminal hẹp, sidebar tự ẩn thay vì ép nội dung chat thành những dòng quá ngắn.", [edit("layout.ts"), edit("index.ts"), test("node --test sidebar.test.mjs")]),
    turn("bug", "layout", "Sửa lỗi lệch hàng trên VTE", "12:40", "Khi chọn prompt số 10 thì sidebar lệch một ô. Kiểm tra giúp tôi nguyên nhân.",
      "Đã tái hiện lỗi: phép đo chiều rộng của một ký tự không khớp với cách VTE hiển thị. Đây là lỗi ở bước render, không phải dữ liệu prompt.\n\nCó hai hướng thử: bù độ rộng ở layout, hoặc chỉ bù ở output gửi tới terminal.", [read("terminal-width.ts"), read("navigation.ts"), test("python3 smoke.py")]),
    turn("padding", "bug", "Thử bù padding trong layout", "12:42", "Thử thêm một khoảng trắng vào cột sidebar xem sao.",
      "Cách này sửa được một hàng nhưng làm lệch những hàng không có ký tự gây lỗi. Không nên áp dụng padding cố định cho cả panel.\n\nĐây là nhánh thử nghiệm, không phải phương án đang dùng.", [edit("layout.ts"), { name: "bash", target: "python3 smoke.py", result: "FAIL · hàng khác bị thừa một ô trong fixture.", error: true }]),
    turn("padding-stop", "padding", "Dừng hướng padding cố định", "12:44", "Không ổn, dừng cách này lại.", "Đã dừng thử nghiệm. Nhánh này được giữ để tham khảo.", []),
    turn("output", "bug", "Bù chiều rộng tại output", "12:48", "Giữ nguyên layout, chỉ bù khi ghi ra terminal VTE thôi.",
      "Đã chuyển phần bù sang output và giới hạn theo terminal bị ảnh hưởng.\n\n• Không thay đổi tin nhắn hay dữ liệu copy.\n• Không sửa Pi core hoặc cấu hình terminal.\n• Gỡ wrapper khi đóng sidebar hay shutdown.\n\nCác chuỗi điều khiển terminal và URL vẫn được giữ nguyên.", [read("terminal-width.ts"), edit("terminal-width.ts"), test("node --test sidebar.test.mjs"), test("python3 vte-smoke.py")]),
    turn("verify", "output", "Kiểm tra resize và chọn prompt", "12:52", "Kiểm tra chọn prompt 10, 11; resize terminal và đổi sidebar sang trái nữa nhé.",
      "Các trường hợp đã kiểm tra trong bản mẫu:\n\n1. Chọn prompt 10 rồi 11 không làm hàng bên cạnh lệch.\n2. Resize giữ hai cột thẳng hàng.\n3. Đổi bên không thay đổi vị trí nội dung đang xem.\n4. Copy chỉ lấy text trong pane được chọn.\n\nVẫn cần kiểm chứng trực tiếp trên terminal của bạn.", [test("node --test sidebar.test.mjs"), test("python3 smoke.py"), test("python3 vte-smoke.py")]),
    { ...turn("cancelled", "verify", "Thử một cách khác…", "12:54", "Hay thử làm lại phần render…", "Lượt này đã bị hủy trước khi có câu trả lời."), status: "aborted" },
    turn("stream", "verify", "Giảm nhấp nháy khi đang trả lời", "12:56", "Sidebar còn chớp khi Pi đang sinh câu trả lời, sửa tiếp giúp tôi.",
      "Nguyên nhân là kích thước document cập nhật trước khi frame layout mới được commit.\n\nGiữ snapshot hợp lệ gần nhất trong frame chuyển tiếp, nhưng không dùng tọa độ cũ để điều hướng. Chỉ yêu cầu repaint khi danh sách hoặc mục active thay đổi.", [read("navigation.ts"), edit("index.ts"), test("node --test sidebar.test.mjs")]),
    turn("docs", "stream", "Ghi lại cách chạy demo", "13:02", "Thêm hướng dẫn chạy và các giới hạn của bản demo.",
      "Đã bổ sung hướng dẫn mở demo, phím điều hướng và checklist kiểm thử.\n\nDemo chỉ load thủ công, không tự thêm vào settings hay package public.", [edit("README.md")]),
    turn("tree", "docs", "Làm session tree dễ nhìn hơn", "13:06", "Tree của Pi thực sự khá khó nhìn. Có cách nào dễ nhìn và thân thiện hơn không?",
      "Có. Mình sẽ làm giống lịch sử chat quen thuộc:\n\n1. Danh sách chỉ hiện những câu bạn đã hỏi.\n2. Chọn một câu rồi Enter để đọc lại câu trả lời.\n3. Những hướng thử khác được để riêng, cần mới mở.\n\nKhông còn hai khung, log công cụ hay một loạt trạng thái kỹ thuật. Nhấn mũi tên trái để quay lại danh sách.", [read("tree-model.ts"), edit("tree-view.ts"), test("node --test tree.test.mjs")]),
  ];
}
