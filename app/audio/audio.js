import { bind, play, setEnabled, setTheme, setVolume } from 'cuelume';

// Cuelume is the single source of truth for Keyflow sounds. The previous
// direct AudioContext path was removed because WebKitGTK on Linux routes Web
// Audio through GStreamer; if the AppImage omits those plugins, every custom
// WebAudio implementation fails in exactly the same way. The packaging layer
// now bundles the required GStreamer media framework and this module focuses
// only on interaction semantics.

let enabled = true;
let volume = 0.82;
let keySounds = true;
let profile = 'mechanical';
let initialized = false;
let cuesRequested = 0;
let failures = 0;
let lastError = '';
let lastCue = '';
let lastCueAt = 0;

const THEMES = {
  mechanical: 'mech',
  soft: 'default',
  minimal: 'press',
  playful: 'bubble'
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

function emitStatus() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('keyflow-audio-status', { detail: getAudioStatus() }));
}

function configureCuelume() {
  try {
    setEnabled(enabled);
    setVolume(volume);
    setTheme(THEMES[profile] || 'mech');
    if (!initialized && typeof document !== 'undefined') {
      // Delegated bindings are idempotent and give Keyflow's marked controls
      // the same material vocabulary as the typing coach.
      bind(document);
      initialized = true;
    }
    lastError = '';
    emitStatus();
    return true;
  } catch (error) {
    failures += 1;
    lastError = error?.message || String(error);
    emitStatus();
    return false;
  }
}

function keyRole(character) {
  if (character === ' ' || character === '\t') return 'space';
  if (character === '\n') return 'enter';
  return 'printable';
}

function emphasisForProfile() {
  if (profile === 'minimal') return 'subtle';
  if (profile === 'mechanical') return 'normal';
  return 'normal';
}

function requestCue(name, options = {}) {
  if (!enabled) return false;
  try {
    // Cuelume lazily creates and resumes its shared AudioContext on this call.
    // playFeedback is invoked directly from Keyflow's keydown stack, so the
    // first sound is requested while WebKit still considers the key press a
    // user gesture.
    play(name, options);
    cuesRequested += 1;
    lastCue = name;
    lastCueAt = Date.now();
    lastError = '';
    if (cuesRequested <= 3 || name === 'error' || name === 'success') emitStatus();
    return true;
  } catch (error) {
    failures += 1;
    lastError = error?.message || String(error);
    emitStatus();
    return false;
  }
}

export function initAudio({ soundEnabled = true, soundVolume = 0.82, keyClickSounds = true, soundProfile = 'mechanical' } = {}) {
  enabled = !!soundEnabled;
  volume = clamp(soundVolume);
  keySounds = !!keyClickSounds;
  profile = Object.hasOwn(THEMES, soundProfile) ? soundProfile : 'mechanical';
  configureCuelume();
  return true;
}

export function warmAudioLater(options = {}) {
  // Configure only. Cuelume itself keeps AudioContext lazy until a real user
  // action asks it to play a cue.
  initAudio(options);
}

export function applyAudioSettings({ soundEnabled, soundVolume, keyClickSounds, soundProfile = profile }) {
  enabled = !!soundEnabled;
  if (Number.isFinite(Number(soundVolume))) volume = clamp(soundVolume);
  keySounds = !!keyClickSounds;
  profile = Object.hasOwn(THEMES, soundProfile) ? soundProfile : profile;
  configureCuelume();
  return true;
}

export function primeAudioFromGesture() {
  // Intentionally no synthetic oscillator or silent warm-up. Cuelume should
  // receive the actual first meaningful cue from the same keydown/click stack.
  if (!initialized) configureCuelume();
}

export function playFeedback(kind, detail = {}) {
  if (!enabled) return false;

  const emphasis = emphasisForProfile();
  if (kind === 'key') {
    if (!keySounds) return false;
    return requestCue('type', { key: keyRole(detail.character), emphasis });
  }
  if (kind === 'word') {
    if (!keySounds) return false;
    return requestCue('type', { key: keyRole(detail.character || ' '), emphasis });
  }
  if (kind === 'delete') {
    if (!keySounds) return false;
    return requestCue('type', { key: 'delete', emphasis });
  }
  if (kind === 'error') {
    return requestCue('error', { emphasis: 'strong', volume: 1 });
  }
  if (kind === 'complete') {
    return requestCue('success', { emphasis: 'strong', volume: 1 });
  }
  if (kind === 'ready') {
    return requestCue('ready', { emphasis: 'normal' });
  }
  if (kind === 'ui') {
    return requestCue('tap', { input: 'mouse', emphasis: 'subtle' });
  }
  return false;
}

export async function testAudio() {
  if (!enabled) return getAudioStatus();
  configureCuelume();
  requestCue('type', { key: 'printable', emphasis: 'normal', volume: 1 });
  await new Promise(resolve => setTimeout(resolve, 130));
  requestCue('type', { key: 'space', emphasis: 'normal', volume: 1 });
  await new Promise(resolve => setTimeout(resolve, 160));
  requestCue('error', { emphasis: 'strong', volume: 1 });
  await new Promise(resolve => setTimeout(resolve, 220));
  requestCue('success', { emphasis: 'strong', volume: 1 });
  return getAudioStatus();
}

export function getAudioStatus() {
  return {
    backend: 'cuelume',
    state: lastError ? 'failed' : (cuesRequested ? 'active' : 'ready'),
    enabled,
    keySounds,
    profile,
    theme: THEMES[profile] || 'mech',
    volume,
    cuesRequested,
    failures,
    lastCue,
    lastCueAt,
    lastError
  };
}
