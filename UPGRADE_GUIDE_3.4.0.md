# Upgrading KeyFlow Next from 3.3.0 to 3.4.0

1. **Back up your practice data.** In the existing app export your private Data Vault before replacing or installing anything. API keys remain in your separate credential storage; do not export or share them.
2. **Update source without clearing app data.** Extract the 3.4.0 ZIP and copy the complete `keyflow/` folder contents to your project repository, preserving `.github/`. Do not delete Tauri/WebKit app storage, IndexedDB or your KDE Wallet credentials.
3. **Run checks locally** on Node 22: `npm ci && npm run check`. For the full Chromium reproduction, install Playwright/Chromium and run `npm run test:ai:browser`, `npm run test:studio:browser`, and `npm run test:responsive:browser`.
4. **Build** using the included GitHub Actions workflow or your Linux Tauri toolchain; these require Rust and Tauri/WebKitGTK OS packages. The release archive is complete **source**, not a precompiled AppImage.
5. **Reproduce the original bug.** AI Studio → generate text → confirm **Saved · not practiced yet** and **Practice now** enabled → click Practice now → do not type → close/reopen app. The generated passage should appear ready, still **unfinished**, not exhausted.
6. **Exercise the completed path.** Type all the way to the end of that generated passage. It should then become a completed run in Library, and the unfinished reminder should clear.
7. **Check the near-text guide.** On desktop or at a 480px narrow window, the ribbon labelled **NEXT** / **PRESS** sits immediately above the passage, showing physical key/finger guidance and the most recent incorrect vs expected character. More detailed hints remain available in **Training details**.
8. **Review AI output.** Use **Use my real typing weaknesses**, **Edit and validate**, model discovery, and the existing Speed/Balanced/Quality controls. If saving fails, use **Retry saving** or **Copy passage**; **Practice now** remains unavailable until the local write succeeds.

## Compatibility and migration

No IndexedDB schema or API-key-storage format migration is needed. Existing saved sessions and imported passages are preserved. The new `keyflow.ai.pending.v1` reminder refers only to the latest unfinished AI passage; **all validated generated passages are independently retained in the Library database**. Old generated passages that were never saved in 3.3.0 cannot be reconstructed by this update after the previous process has already exited.

## Remaining verification

Run and inspect the resulting AppImage on your EndeavourOS/KDE machine. The source/browser checks do not prove actual WebKitGTK database persistence, KWallet operation, or live AI provider correctness and billing.
