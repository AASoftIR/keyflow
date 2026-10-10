# Build fix 2.1.1

The previous workflow failed before Vite/Rust because the npm Tauri CLI could not load `@tauri-apps/cli-linux-x64-gnu`.

Keyflow's Linux target is EndeavourOS/Arch, so 2.1.1 removes the npm Tauri CLI completely and uses the official Arch `cargo-tauri` package.

## Local EndeavourOS

```bash
sudo pacman -S --needed \
  base-devel git curl file \
  nodejs-lts-jod npm rust cargo-tauri \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf fuse2

npm install
npm run check
npm run tauri:build
```

`npm run tauri:build` now expands to `cargo tauri build`.

## CI output

Only AppImage is packaged. GitHub artifact storage is not used. Push/manual builds upload:

- `*.AppImage`
- `SHA256SUMS.txt`

to the AASoft Serv00 uploader using `SERV00_UPLOAD_TOKEN`; `SERV00_UPLOAD_URL` is optional and defaults to `https://files.aasoft-com.serv00.net/ci.php`.
