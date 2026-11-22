# Upgrade to KeyFlow 3.5.0

1. Extract the complete source ZIP and run the existing build workflow (`npm install`, `npm run check`, `npm run tauri:build`) on your Linux machine. This release contains source code and AppImage build scripts, not a precompiled AppImage.
2. Your existing saved settings, passages, credentials and practice records remain in place. Preferences migrate to schema 14 by adding `timeTrialMode: "off"`; other settings are retained.
3. Open **Practice**. Choose **TIME TRIAL → Intermediate** or **Professional**. The countdown appears just above the next-key strip; it starts on the first typed character. Switching to a fixed-duration Sprint turns Time Trial off, and vice versa.
4. If you miss the deadline, examine the partial review and the Library → Detailed stats record. The passage is still unfinished and remains available for another attempt. The per-text score uses only completed coverage and actual accuracy.
5. In **AI Studio**, select **GroqCloud**, refresh its live models, and try a short Qwen 3.8 passage first. A 429 indicates your external account's rate limit, not an invalid app model list. The Studio explains token budgets and retains copyable, credential-scrubbed diagnostics.
6. For Groq Long/Endurance output, consider a model/provider with sufficient output quota. The **Build prompt for external AI** and **Paste AI answer** workflow still works without app-side generation.

If a saved API key is not available, check the desktop's unlocked KWallet/Secret Service. KeyFlow does not put raw credentials in localStorage. Use the **Save config** button after entering an API key, then **Test selected model** to verify a readable completion.

Unverified in this environment: real paid/free provider accounts, native AppImage startup, WebKitGTK rendering, and host-specific wallet/keyring behavior.
