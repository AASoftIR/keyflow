# Keyflow Next 2.7.0 — Freshness, performance and training

This is the first version that **refuses to silently repeat recently displayed passages**. Normal practice protects every source text included in a multi-part smart deck for 21 days (configurable to 7, 14, 21, 30 or 90). Duplicate content with another ID and highly similar texts are screened, and previous 2.6.2 history is migrated. Exhaustion is clearly shown with explicit AI/import/replay options. A short fresh passage is preferred to a padded, repeated one.

The built-in library is expanded from 48 to **84** original/public-domain texts (42 English, 42 Persian), with 36 newly written original passages. New practice tools: timed sprints, eight-part precision map, word horizon, Zen mode, saved passages and context-based coaching.

The typing engine now isolates failed audio callbacks, filters named keys, cleans up viewport observers on remount and protects personal bests from incomplete sprints. Cold-start can fall back to fresh imported/AI texts when bundled material is exhausted.

**Testing:** Run `npm run check`, `python tests/run-highlight-browser.py`, and `python tests/run-practice-2.7-browser.py`. These do not replace a native AppImage runtime check on EndeavourOS. See `docs/AUDIT_AND_ROADMAP_2.7.0.md`.

Release remains AppImage only; Serv00 upload workflow is unchanged.
