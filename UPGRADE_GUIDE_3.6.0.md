# Upgrade to KeyFlow Next 3.6.0

## Install or build

1. Keep your previous v3.5 source/build as a recoverable backup. The v3.6 ZIP is a full independent source tree.
2. Extract v3.6. On a Node 22 development system: `npm ci` if you have generated a compatible lockfile, or `npm install`; then `npm run check` and `npm run build`.
3. For a native Linux build, install the required Tauri 2/GTK/WebKitGTK tools and use `npm run tauri:build`. Follow existing AppImage runtime prerequisites and media-framework audits.
4. Your saved preferences and IndexedDB texts/sessions migrate in place via schema 15. An unfinished saved AI passage is never marked complete by previewing or merely starting to type it. **Back up through Data Vault before replacing your working installation.**

## Try the new options

1. Open **Practice → Options → Accuracy goal** and select 95%, 97% or 99%. The fixed-height row above your passage displays live progress toward the target. Leave Off if you prefer just the usual accuracy percentage.
2. Open **Settings → Local voice guidance**. If it lists on-device voices, choose one, test it, and select Mistakes / Milestones / Both. Voice is Off by default. If it reports no local voice, the feature cannot speak on the current speech backend; regular Cuelume cues still work. The Practice quick Voice button cycles the modes.
3. Open **AI Studio → Training mission**. Select punctuation, numbers, transitions, rhythm, real-world or natural flow. For an account with strict per-minute output limits, click **Low-quota setup** before generating. Read the plan summary. Model-list success does not guarantee readable generation.
4. Once generation succeeds, review the passage counts and health score. **Practice now** starts only after it has been saved. **Another variation** intentionally uses additional API tokens. **Build prompt for external AI** is available without a configured provider.

## Important distinctions

- Strict Accuracy still controls whether a wrong key advances; Accuracy goal only scores your objective.
- Short Speed mode can still encounter model, provider or account failures. A rate-limited provider may share quotas across model IDs, so repeated fallback cannot bypass its token pool.
- Voice functionality is limited to voices explicitly marked on-device. To avoid unexpectedly sending practice text to a remote TTS backend, remote or unclassified voices are excluded.
- If Linux WebKitGTK has no local speech synthesis available, leave the speech coach off. The keyboard and regular cues have no speech dependency.
