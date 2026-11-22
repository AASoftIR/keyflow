# Upgrade to KeyFlow Next 3.7.0

## Source and build

1. Keep your working v3.6 build or installation, and export a **Lab → Private Data Vault** backup first. This ZIP is an independent complete source tree; it does not patch or delete your earlier release.
2. Extract the source. Use the project's **Node 22** runtime, install dependencies with `npm install` (there is no committed npm lockfile), then run `npm run check` and `npm run build`.
3. To produce the native application, install your usual Tauri 2 Rust/GTK/WebKitGTK toolchain on EndeavourOS, then run `npm run tauri:build`. Follow the included AppImage GStreamer/media and Mesa ABI runtime checks. This source release is **not** a prebuilt AppImage.
4. Existing IndexedDB sessions, custom texts, seen history, staged AI drafts, and Secret Service/KDE Wallet credentials remain in place if installed over the same app identity. The settings schema now migrates to **16**. No API key is put in localStorage by this change.

## Try the new capabilities

1. Open **Practice → Options → Look ahead**. Choose 2, 4 or 6 upcoming keys, or Off. The immediate `NEXT / PRESS / FINGER` guide stays above the typing passage.
2. Click **8s frame probe** under the Practice insights, then type continuously. Compare its frame p95 with the existing **input p95** metric. The probe itself does not run before you click it.
3. Open **Settings → Responsiveness → Measure 6s frame stability**. You will also see up to twelve earlier measurements made here or in Practice. They are local and included in future Data Vault exports.
4. Finish a session, choose **Replay keystrokes**, then play, pause, seek, change speed, step one key and turn Follow off to examine corrections. A red mistake disappears after Backspace or a repaired strict-accuracy key.
5. For a real responsiveness comparison: choose an Endurance passage in Persian, resize the app below full screen, record p95 in Balanced, then switch to Ultra latency and repeat the **same passage**. Record both results; external compositor activity may still vary.

## If you still see a frozen cursor

- Open Settings → Responsiveness and perform a frame probe during the lag; also check Practice's **input p95**.
- Test with **Ultra latency**, **Reduce motion**, and **Show visual keyboard → Off**. If the problem remains, note whether the cursor is wrong before or after scrolling/reflow, and whether the sentence is Persian with half-spaces.
- Record the **window size, distro, KDE/Wayland or X11 session, GPU vendor**, and AppImage renderer mode from Settings → Linux graphics.
- Use `npm run test:responsive:browser` on a machine where Chromium/Playwright is available. A true WebKitGTK/AppImage reproduction requires running on your own system.

## Behavioral notes

- Unstarted, partially typed, timed-out and completed passages keep their previous distinct usage rules: only a saved **full completion** consumes a source passage. The migration that repairs old falsely-used texts now runs on deck exhaustion or the first successful completion, not on the initial screen.
- The frame probe only stores measurement summaries, not typed text or key events. It does not send data over the network.
- All earlier AI options, imported passages, difficulty progression, voice settings, and provider configurations are preserved. Actual API success still depends on account tokens and text-capable live models.
