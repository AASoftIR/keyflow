# Upgrading KeyFlow Next 3.0.0 to 3.1.0

1. Back up your progress first using the existing Data Vault export in the Lab. For a second layer of safety, copy the application profile and WebKitGTK data directory before upgrading.
2. Extract the new `keyflow/` source over the *repository source*, preserving the `.github/` workflow directory. Do not overwrite your user profile or local credential wallet with project files.
3. Use the repository's GitHub Actions workflow to build the Linux AppImage or use the normal local Tauri/Vite toolchain.
4. In Practice, choose **Auto** to continue using your earned tier, or manually select Beginner / Easy / Medium / Hard / Expert. This is a content preference; it does not award skill level or XP.
5. Select Quick / Standard / Long / Endurance independently. If you have already practiced most exact-level passages inside the freshness window, use a different mode, switch the level explicitly, or choose a repeat option; the app will not disguise an out-of-tier passage as a match.
6. Resize the window as needed. The stable next-character guide and last-mistake panel are above the text; the expected key/chord appears in the guide, and your wrong key appears next to the expected glyph when a mistake occurs.
7. Re-run `npm run check` if maintaining a fork. For Chromium-only UI regressions use `npm run test:responsive:browser` (requires Playwright).

API keys remain managed by the existing native credential workflow; these releases do not embed credentials.
