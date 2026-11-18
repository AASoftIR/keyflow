# Upgrade KeyFlow Next 3.1 → 3.2

## Before replacing source

1. Use **Training Lab → Data Vault → Export** and keep your JSON backup outside
   the application folder. The vault excludes native secret-store API keys.
2. Save a copy of your existing repository or commit all local changes.
3. Extract `Keyflow-Next-v3.2.0-...-Source.zip` and replace the source files
   in your existing repository with the contents of `keyflow/`, including the
   hidden `.github` directory if you use the included GitHub Actions workflow.
   Do not delete native OS credential-wallet entries or IndexedDB profile data.
4. Use `npm run check` with Node 22. For the compiled Linux app use the included
   GitHub Actions workflow on its documented Linux runner, or a local toolchain
   with Rust, Tauri dependencies and Node 22.
5. Open Practice. Wait for a nonessential background migration to reconcile old
   first-key usage records. Selecting a new passage does not itself count as
   practicing or completing it.

## Validate the fixes

- Open a new passage; type a few characters; use **New text** or navigate away.
  It must remain available later rather than counting as completed.
- Finish a single passage. Only then should its source be protected by the
  anti-repeat cooldown.
- Start a timed mixed deck and stop mid-way through a later component: earlier
  fully finished components may count, later components must not.
- Visit AI Studio. Start with a non-reasoning text model, **Speed** and **Test
  selected model**. A successful model-list refresh alone does not verify the
  chat-completions endpoint. Use **Balanced** for model fallback; if Dahl says
  HTTP 402, allocate tokens to the *key*, not just your account pool.
- Change Settings → Personal workspace, leave Settings and return; confirm the
  palette, caret, keyboard visibility and reading width persist.

## Data/privacy notes

- Stored sessions and saved custom texts stay in IndexedDB.
- Small readiness, visual, and model-health preferences stay in localStorage.
  Health counters never include API keys, prompts, model output, or full errors.
- Keys remain in the native Secret Service/KWallet credential backend. The
  native wallet must be unlocked for credentials to be read; never paste keys
  into issue logs.
- Cancellation halts the frontend and retries. An already-sent Tauri HTTP IPC
  request cannot be guaranteed to stop server-side processing or billing.

## Tests and limitations

- `npm run check` covers source, API mocks, history migration, and app contracts.
- `python tests/run-v31-browser.py` checks caret and resize performance.
- `python tests/run-v32-appearance-browser.py` checks the visual preferences.
- Native AppImage smoke and live provider requests need to be performed on the
  actual Linux system with the user's environment and credentials.
