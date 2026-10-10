# 2.4.0 reliability fixes

The screenshot showing 1,716,000 WPM exposed a timing-integrity bug, not real input speed. Keyflow now scores only monotonic active typing time, rejects impossible sessions, and never lets an anomalous run become a PB. The same release fixes a transient-startup blur pause, a stale Training Lab rank import/progress property, a proxy-test result naming mismatch, a first-audio-cue cadence edge case, and stale test contracts inherited from earlier audio defaults.

The source was not packaged until `npm run check` passed after these corrections.
