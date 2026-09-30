# Keyflow 2.1.1 — Arch-native build fix

## Root cause

The failed workflow was not a Rust or application-code failure. The npm-installed Tauri CLI tried to load its architecture-specific native binding and npm had omitted:

```text
@tauri-apps/cli-linux-x64-gnu
```

That is the optional-dependency failure described by npm/cli#4828. Retrying `npm install` can sometimes hide it, but that is not a reliable CI design.

## Permanent fix for EndeavourOS / Arch

Keyflow no longer installs the Tauri CLI from npm at all.

The workflow installs the official Arch package:

```text
cargo-tauri
```

and `npm run tauri:build` now executes:

```text
cargo tauri build
```

This removes the entire npm native-binding failure path instead of adding a retry around it.

The frontend still uses Node/npm for Vite and Cuelume, with Arch's Node 22 LTS (`nodejs-lts-jod`) rather than rolling Node Current.

## Serv00 uploader

`actions/upload-artifact` has been removed.

On push/manual runs the workflow uploads directly to the user's AASoft Serv00 uploader:

- the AppImage;
- `SHA256SUMS.txt`;
- repository;
- branch;
- commit;
- run ID/number;
- workflow;
- job;
- tag.

Required GitHub secret:

```text
SERV00_UPLOAD_TOKEN
```

Optional URL secret:

```text
SERV00_UPLOAD_URL
```

If the URL secret is absent, the workflow uses:

```text
https://files.aasoft-com.serv00.net/ci.php
```

Pull requests compile and test but do not upload because repository secrets are intentionally unavailable to untrusted PRs.
