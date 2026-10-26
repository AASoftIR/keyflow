# Updating an existing Keyflow 2.8.2 installation to 3.0.0

1. **Back up your existing app data before deploying**; the older application exports sessions from Lab → Export history. In 3.0.0 the new **Data Vault** exports much more, including personal texts and scheduled review dates. If you can, make a temporary copy of the old application's profile / WebKitGTK storage.
2. Unzip this archive. Copy the **contents of `keyflow/`** into the root of your repository (including `.github/` and `src-tauri/`). Do not nest another `keyflow/` directory inside your existing repo root.
3. Commit the changes and run the existing GitHub Actions Linux workflow. This source bundle intentionally does **not** include a prebuilt AppImage.
4. Open the new app. Its bundle identifier and IndexedDB database names did not change; existing stored sessions/settings should remain in place. Native KWallet credentials are not moved or exported by this package.
5. Open **Lab → Data Vault** and export a full JSON backup. Keep it private because it includes all typing session logs and personal passages.
6. Try **Lab → Code fluency**, **Guided circuit**, and **Error DNA** first. Practice the same passage twice to enable the **Personal-best ghost**. Fully completed valid passages seed **Due reviews**. Typing part of a text and leaving will not mark a review complete.
7. Test **interruption recovery** by entering several letters, leaving Practice, then opening Lab → Resume saved session. It should continue from the next expected letter with active-time scoring only.
8. For AI use, test your provider and wallet key in **AI Studio**; no AI/network credentials are included in this source or in Data Vault exports.

## Local source QA

```bash
npm install
npm run check
npm run test:checkpoint:browser   # requires Python playwright + system Chromium
npm run tauri:build              # requires Rust toolchain and Linux Tauri dependencies
```

Do not claim a passing local AppImage build unless `npm run tauri:build` actually completes on your machine or in Actions. The new eight features run locally with no AI token requirement.
