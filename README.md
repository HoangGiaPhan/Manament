# Hotel Management – v3 (updated)

## Included
- Room calendar, booking CRUD, user management, room management, search, backup/import/export.
- Keeps the original scheduled check-in and check-out timestamps separate from actual check-in and check-out timestamps.
- Actual check-in/out timestamps can be entered or corrected manually in the booking form.
- Check-in and check-out action buttons record the current actual time without overwriting the scheduled booking interval.
- Late check-in and overtime warnings.
- Date display/input format: DD/MM/YY. Time format: 24-hour HH:mm (no AM/PM).
- Local browser storage.

## Date/time entry
Enter booking and actual timestamps as `DD/MM/YY HH:mm`, for example `21/11/26 18:30`.
The top calendar date uses `DD/MM/YY`.

## Run
Open `index.html` in a modern browser.

Demo accounts only for a fresh local data store:
- manager: `admin` / `admin123`
- staff: `nhanvien` / `123456`

## Limitations
This is a local prototype. It does not yet have an online shared database, secure server-side authentication, or email password recovery. Static deployment does not sync data between devices.
