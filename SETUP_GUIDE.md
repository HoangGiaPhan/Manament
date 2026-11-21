# HƯỚNG DẪN CÀI ĐẶT WEBSITE QUẢN LÝ ĐẶT PHÒNG

> Dùng khi muốn triển khai **một hệ thống mới** từ mã nguồn GitHub, với Vercel và Supabase mới. Hướng dẫn đi cùng `setup.sql` trong repository.
>
> **Không chạy `setup.sql` trên Supabase đang vận hành** nếu chưa sao lưu và kiểm tra kỹ. File này được thiết kế cho project Supabase mới, trống.

## 1. Chuẩn bị

- Tài khoản GitHub chứa các file `index.html`, thư mục `css/`, `js/`, `setup.sql`.
- Tài khoản Supabase và Vercel.
- Email để tạo tài khoản quản lý đầu tiên.

**Lưu ý:** `setup.sql` chỉ tạo **cấu trúc** và quyền truy cập. Nó **không** sao chép phòng, lịch đặt, tài khoản hay mật khẩu từ hệ thống cũ.

## 2. Tạo Supabase mới

1. Truy cập https://supabase.com/dashboard và chọn **New project**.
2. Đặt tên project, chọn region phù hợp, đặt mật khẩu database mạnh và lưu ở nơi an toàn.
3. Chờ project được khởi tạo.
4. Vào **SQL Editor → New query**.
5. Mở file `setup.sql` trong GitHub, sao chép toàn bộ nội dung và dán vào SQL Editor.
6. Nhấn **Run**. Chỉ tiếp tục nếu không có lỗi.

Sau khi chạy, vào **Database → Tables** (hoặc **Table Editor**) kiểm tra ba bảng:

| Bảng | Công dụng |
| --- | --- |
| `hp_profiles` | Email và quyền `manager` / `staff` |
| `hp_rooms` | Danh sách phòng |
| `hp_bookings` | Lịch đặt phòng và phiên bản cập nhật |

SQL còn tạo chính sách RLS, hàm `save_booking_if_version`, trigger chống trùng lịch và đăng ký Realtime cho `hp_rooms`, `hp_bookings`.

## 3. Tạo tài khoản quản lý đầu tiên

1. Trong Supabase mới, mở **Authentication → Users**.
2. Chọn **Add user → Create new user** (tên nút có thể thay đổi).
3. Nhập email và mật khẩu cho tài khoản quản lý; tạo tài khoản. Nếu có lựa chọn xác nhận email, thực hiện theo giao diện Supabase.
4. Sao chép **User UID** của tài khoản vừa tạo (UUID, **không phải email**).
5. Quay lại **SQL Editor → New query** và chạy SQL sau, thay `UUID_THAT` và email bằng thông tin thật:

```sql
insert into public.hp_profiles (id, email, role)
values (
  'UUID_THAT',
  'admin@example.com',
  'manager'
);
```

Ví dụ `UUID_THAT` phải là một UUID thực tế từ Authentication → Users. Không nhập mật khẩu vào SQL hoặc `hp_profiles`.

**Kiểm tra:** `hp_profiles` phải có đúng một dòng cho tài khoản này, với `role = manager`. Tài khoản Auth chưa có dòng profile sẽ không đăng nhập sử dụng app được.

## 4. Lấy URL và khóa Supabase

1. Vào **Project Settings → API** hoặc **Connect** (tùy giao diện).
2. Sao chép **Project URL** và **publishable key** (hoặc `anon` public key nếu project đang dùng loại cũ).
3. Trong GitHub, mở `js/app.js` → **Edit**.
4. Tìm hai dòng và thay bằng giá trị của project mới:

```javascript
const SUPABASE_URL = 'https://PROJECT_ID.supabase.co';
const SUPABASE_KEY = 'PUBLISHABLE_KEY_CUA_PROJECT_MOI';
```

5. Chọn **Commit changes**.

**Bảo mật:** Chỉ đặt publishable/anon key trong JavaScript phía trình duyệt. **Tuyệt đối không** đưa `service_role` hoặc secret key vào `app.js`, GitHub công khai hay Vercel frontend.

## 5. Deploy lên Vercel

1. Mở https://vercel.com/dashboard → **Add New → Project**.
2. Import repository GitHub chứa website.
3. Vì đây là website HTML/CSS/JavaScript tĩnh, chọn cấu hình phù hợp cho static site; thư mục gốc chứa `index.html`.
4. Nhấn **Deploy**.
5. Sau khi hoàn tất, vào project Vercel → **Domains** và sao chép **domain production thật**, ví dụ `https://hotel-moi.vercel.app`.

Nếu repository đã kết nối Vercel, mỗi lần commit thay đổi `app.js`, Vercel thường sẽ triển khai phiên bản mới tự động. Chờ trạng thái deployment **Ready** trước khi kiểm tra.

## 6. Cấu hình link đăng nhập / quên mật khẩu

Trong Supabase **Authentication → URL Configuration**:

**Site URL** (thay bằng domain production thật):

```text
https://hotel-moi.vercel.app
```

**Redirect URLs** (thêm một mục):

```text
https://hotel-moi.vercel.app/**
```

Lưu cấu hình. Đừng để các domain ví dụ như `ten-khach-san.vercel.app` nếu đó không phải website thật.

> Code khôi phục mật khẩu dùng URL hiện tại của website để chuyển hướng. Nếu dùng domain riêng, hãy cập nhật Site URL và thêm domain đó vào Redirect URLs. Link khôi phục cũ có thể không dùng được; hãy thử bằng email mới khi không bị giới hạn gửi email.

## 7. Kiểm tra sau khi cài đặt

Thực hiện theo thứ tự:

- [ ] Mở website trên domain Vercel thật.
- [ ] Đăng nhập bằng tài khoản quản lý đã tạo.
- [ ] Kiểm tra có thể tạo phòng (nếu chưa có phòng, ứng dụng có thể tự tạo phòng 101–105 cho manager).
- [ ] Tạo một lịch đặt thử và tải lại trang: lịch vẫn tồn tại.
- [ ] Mở website trên **hai trình duyệt / hai thiết bị**: tạo hoặc sửa lịch trên máy A, kiểm tra máy B tự cập nhật.
- [ ] Thử hai máy sửa cùng một booking: máy lưu sau phải nhận cảnh báo xung đột thay vì âm thầm ghi đè.
- [ ] Thử tạo hai booking trùng phòng, trùng giờ: hệ thống phải từ chối.
- [ ] Thử chức năng quên mật khẩu bằng **email mới**, kiểm tra form tạo mật khẩu mới xuất hiện.

Nếu lỗi, mở Developer Tools → Console và xem thông báo; kiểm tra lại URL/key, profile của user, chính sách RLS và Realtime.

## 8. Thêm nhân viên

Tạo user trong **Authentication → Users**, lấy UID rồi tạo profile bằng SQL:

```sql
insert into public.hp_profiles (id, email, role)
values ('UUID_NHAN_VIEN', 'nhanvien@example.com', 'staff');
```

Vai trò `staff` có thể đọc và cập nhật booking thông qua hàm được cấp quyền, nhưng không được sửa danh sách phòng theo RLS của file setup. Chỉ người có quyền quản trị Supabase mới nên thực hiện các câu lệnh SQL tạo profile.

## 9. Nếu muốn chuyển dữ liệu từ Supabase cũ

**Đừng chỉ chạy `setup.sql` rồi cho rằng đã chuyển xong dữ liệu.** Cần có kế hoạch riêng để chuyển:

1. Bảng `hp_rooms` và `hp_bookings` (gồm trường `version`).
2. Các tài khoản trong Supabase Auth, hoặc tạo lại tài khoản mới.
3. `hp_profiles` phải tham chiếu đúng UID của Auth user trên project mới.
4. Kiểm tra RLS, trigger, Realtime và chức năng sửa lịch đồng thời.

Nếu UID của tài khoản thay đổi khi tạo mới, không thể sao chép nguyên `hp_profiles` mà không đối chiếu UID. Nên sao lưu dữ liệu trước khi chuyển và thử trên project mới trước khi chuyển domain chính thức.

## 10. Những điều cần nhớ

- `setup.sql` **không phải bản backup dữ liệu**.
- Không chạy SQL thiết lập lại trên database production khi chưa kiểm tra.
- Không chia sẻ mật khẩu database, secret key hoặc recovery link.
- Giữ bản `setup.sql` và hướng dẫn này trong GitHub; không lưu thông tin bí mật vào repository.
- Nếu đổi domain Vercel hoặc project Supabase, cần cập nhật cả `js/app.js` và Authentication → URL Configuration.

---

**Gợi ý cấu trúc GitHub**

```text
repository/
├── index.html
├── css/
├── js/
│   └── app.js
├── setup.sql
├── SETUP_GUIDE.md
└── README.md
```

*Tài liệu này mô tả quy trình cài đặt dựa trên `setup.sql` hiện có và mã nguồn đã cung cấp; chưa thay thế việc kiểm thử thực tế trên project Supabase mới.*
