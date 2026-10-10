# Keyflow 2.1.2

- Fixed the Vite/Rollup `KEY_ROWS` / `PHYSICAL_ROWS` export mismatch.
- Added a compatibility `KEY_ROWS` alias in the layout module.
- Added an ESM module-contract auditor to CI so missing local exports are caught before the expensive Tauri build.
- Added JavaScript syntax checks for the whole app module graph.
- Kept the EndeavourOS/Arch AppImage-only workflow and Serv00 artifact uploader.
