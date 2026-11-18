# Keyflow 2.1.3

- Fixed Rust `E0716: temporary value dropped while borrowed` in Linux GPU-vendor detection.
- Changed GPU vendor labels to owned `String` values, eliminating the lifetime hazard.
- Added Rust source contract checks for the exact temporary-borrow class that caused 2.1.2 to fail.
- Added a native `cargo check` CI stage before Tauri/AppImage packaging.
- Kept EndeavourOS/Arch as the sole Linux target and AppImage as the sole package format.
- Kept the AASoft Serv00 uploader as the only build-file destination.
