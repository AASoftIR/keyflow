import { normalizeForComparison } from './normalization.js';

export const PHYSICAL_ROWS = [
  ['Backquote','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0','Minus','Equal','Backspace'],
  ['Tab','KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP','BracketLeft','BracketRight','Backslash'],
  ['CapsLock','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon','Quote','Enter'],
  ['ShiftLeft','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash','ShiftRight'],
  ['ControlLeft','AltLeft','Space','AltRight','ControlRight']
];

// Compatibility alias for older UI code. New code uses PHYSICAL_ROWS.
export const KEY_ROWS = PHYSICAL_ROWS;

const EN = {
  Backquote:['`','~'], Digit1:['1','!'], Digit2:['2','@'], Digit3:['3','#'], Digit4:['4','$'], Digit5:['5','%'],
  Digit6:['6','^'], Digit7:['7','&'], Digit8:['8','*'], Digit9:['9','('], Digit0:['0',')'], Minus:['-','_'], Equal:['=','+'],
  KeyQ:['q','Q'], KeyW:['w','W'], KeyE:['e','E'], KeyR:['r','R'], KeyT:['t','T'], KeyY:['y','Y'], KeyU:['u','U'], KeyI:['i','I'], KeyO:['o','O'], KeyP:['p','P'],
  BracketLeft:['[','{'], BracketRight:[']','}'], Backslash:['\\','|'],
  KeyA:['a','A'], KeyS:['s','S'], KeyD:['d','D'], KeyF:['f','F'], KeyG:['g','G'], KeyH:['h','H'], KeyJ:['j','J'], KeyK:['k','K'], KeyL:['l','L'],
  Semicolon:[';',':'], Quote:["'",'"'],
  KeyZ:['z','Z'], KeyX:['x','X'], KeyC:['c','C'], KeyV:['v','V'], KeyB:['b','B'], KeyN:['n','N'], KeyM:['m','M'], Comma:[',','<'], Period:['.','>'], Slash:['/','?'], Space:[' ',' ']
};

// Exact XKB mapping for /usr/share/X11/xkb/symbols/ir -> xkb_symbols "pes".
// Levels are [base, Shift, AltGr, AltGr+Shift].  Keeping all four levels matters
// because Persian punctuation and ZWNJ are exactly where a typing trainer cannot guess.
const FA_XKB_STANDARD = {
  Backquote:['\u200D','÷','~'],
  Digit1:['۱','!','`','1'], Digit2:['۲','٬','@','2'], Digit3:['۳','٫','#','3'], Digit4:['۴','﷼','$','4'],
  Digit5:['۵','٪','%','5'], Digit6:['۶','×','^','6'], Digit7:['۷','،','&','7'], Digit8:['۸','*','•','8'],
  Digit9:['۹',')','\u200E','9'], Digit0:['۰','(','\u200F','0'], Minus:['-','ـ','_'], Equal:['=','+','−'],
  KeyQ:['ض','ْ','°'], KeyW:['ص','ٌ'], KeyE:['ث','ٍ','€'], KeyR:['ق','ً'], KeyT:['ف','ُ'], KeyY:['غ','ِ'], KeyU:['ع','َ'], KeyI:['ه','ّ','\u202D'],
  KeyO:['خ',']','\u202E'], KeyP:['ح','[','\u202C'], BracketLeft:['ج','}','\u202A'], BracketRight:['چ','{','\u202B'], Backslash:['\\','|','‐'],
  KeyA:['ش','ؤ'], KeyS:['س','ئ'], KeyD:['ی','ي','ى'], KeyF:['ب','إ'], KeyG:['ل','أ','ۀ'], KeyH:['ا','آ','ٱ'], KeyJ:['ت','ة'], KeyK:['ن','»','﴾'], KeyL:['م','«','﴿'],
  Semicolon:['ک',':',';'], Quote:['گ','؛','"'],
  KeyZ:['ظ','ك'], KeyX:['ط','ٓ'], KeyC:['ز','ژ'], KeyV:['ر','ٰ','ٖ'], KeyB:['ذ','‌','‍'], KeyN:['د','ٔ','ٕ'], KeyM:['پ','ء','…'],
  Comma:['و','>',','], Period:['.','<',"'"], Slash:['/','؟','?'],
  Space:[' ','‌','\u00A0','\u202F']
};

// Exact XKB mapping for xkb_symbols "winkeys". This is the legacy Windows-style
// Persian layout available on Linux as “Persian (Windows)”.
const FA_XKB_WINDOWS = {
  Backquote:['÷','×'],
  Digit1:['1','!','۱','‍'], Digit2:['2','@','۲','‌'], Digit3:['3','#','۳','\u200E'], Digit4:['4','$','۴','\u200F'],
  Digit5:['5','%','۵'], Digit6:['6','^','۶'], Digit7:['7','&','۷'], Digit8:['8','*','۸'], Digit9:['9','(','۹'], Digit0:['0',')','۰'], Minus:['-','_'], Equal:['=','+'],
  KeyQ:['ض','ً'], KeyW:['ص','ٌ'], KeyE:['ث','ٍ'], KeyR:['ق','﷼'], KeyT:['ف','،'], KeyY:['غ','؛'], KeyU:['ع',','], KeyI:['ه',']'], KeyO:['خ','['], KeyP:['ح','\\'],
  BracketLeft:['ج','}'], BracketRight:['چ','{'], Backslash:['پ','|'], IntlBackslash:['پ','|'],
  KeyA:['ش','َ'], KeyS:['س','ُ'], KeyD:['ی','ِ'], KeyF:['ب','ّ'], KeyG:['ل','ۀ'], KeyH:['ا','آ'], KeyJ:['ت','ـ'], KeyK:['ن','«'], KeyL:['م','»'],
  Semicolon:['ک',':'], Quote:['گ','"'],
  KeyZ:['ظ','ة'], KeyX:['ط','ي'], KeyC:['ز','ژ'], KeyV:['ر','ؤ'], KeyB:['ذ','أ'], KeyN:['د','إ'], KeyM:['ئ','ء'], Comma:['و','<'], Period:['.','>'], Slash:['/','؟'],
  Space:[' ',' ']
};

export const LAYOUTS = {
  'en-us': { id:'en-us', language:'en', label:'English · US', map:EN },
  'fa-standard': { id:'fa-standard', language:'fa', label:'Persian · EndeavourOS/XKB standard (ir/pes)', map:FA_XKB_STANDARD },
  'fa-windows': { id:'fa-windows', language:'fa', label:'Persian · XKB Windows compatibility (ir/winkeys)', map:FA_XKB_WINDOWS }
};

const NON_PRINTABLE_LABELS = {
  Backspace:'⌫', Tab:'Tab', CapsLock:'Caps', Enter:'Enter', ShiftLeft:'Shift', ShiftRight:'Shift',
  ControlLeft:'Ctrl', ControlRight:'Ctrl', AltLeft:'Alt', AltRight:'AltGr', Space:'Space'
};

function chordFromEvent(event) {
  return {
    code: event.code,
    shift: !!event.shiftKey,
    altGraph: event.getModifierState?.('AltGraph') || (!!event.altKey && !!event.ctrlKey),
    alt: !!event.altKey,
    ctrl: !!event.ctrlKey
  };
}

function chordKey(chord) {
  return `${chord.code}|${chord.shift ? 1 : 0}|${chord.altGraph ? 1 : 0}`;
}

export class KeyboardMapper {
  constructor({ profileId='en-us', calibration={}, onLearn=()=>{} } = {}) {
    this.profileId = profileId;
    this.calibration = calibration || {};
    this.onLearn = onLearn;
  }

  setProfile(profileId) { this.profileId = profileId; }

  observe(event, producedCharacter, language) {
    if (!event?.code || !producedCharacter || producedCharacter.length > 4) return;
    if (event.metaKey) return;
    const normalized = normalizeForComparison(producedCharacter, language);
    if (!normalized || /^\p{C}+$/u.test(normalized) && !['‌','‍'].includes(normalized)) return;
    const chord = chordFromEvent(event);
    const previous = this.calibration[normalized];
    if (previous && previous.code === chord.code && previous.shift === chord.shift && previous.altGraph === chord.altGraph) return;
    const record = { ...chord, seenAt: Date.now(), source:'learned' };
    this.calibration[normalized] = record;
    this.onLearn(normalized, record);
  }

  hintFor(character, language) {
    const ch = normalizeForComparison(character, language);
    const learned = this.calibration[ch];
    if (learned) return { ...learned, character:ch, confidence:'learned' };

    const layout = LAYOUTS[this.profileId] || LAYOUTS[language === 'fa' ? 'fa-standard' : 'en-us'];
    const preferredCodes = this.profileId === 'fa-standard' && ch === '‌' ? ['Space','KeyB'] : [];
    for (const code of preferredCodes) {
      const variants=layout.map[code]||[];
      if (variants[0] === ch) return { code, shift:false, altGraph:false, character:ch, confidence:'profile' };
      if (variants[1] === ch) return { code, shift:true, altGraph:false, character:ch, confidence:'profile' };
      if (variants[2] === ch) return { code, shift:false, altGraph:true, character:ch, confidence:'profile' };
      if (variants[3] === ch) return { code, shift:true, altGraph:true, character:ch, confidence:'profile' };
    }
    for (const [code, variants] of Object.entries(layout.map)) {
      if (variants[0] === ch) return { code, shift:false, altGraph:false, character:ch, confidence:'profile' };
      if (variants[1] === ch) return { code, shift:true, altGraph:false, character:ch, confidence:'profile' };
      if (variants[2] === ch) return { code, shift:false, altGraph:true, character:ch, confidence:'profile' };
      if (variants[3] === ch) return { code, shift:true, altGraph:true, character:ch, confidence:'profile' };
    }
    return null;
  }

  displayForCode(code, shift=false) {
    const layout = LAYOUTS[this.profileId] || LAYOUTS['en-us'];
    if (NON_PRINTABLE_LABELS[code]) return NON_PRINTABLE_LABELS[code];
    const variants = layout.map[code];
    return variants?.[shift ? 1 : 0] ?? code.replace(/^Key|^Digit/, '');
  }

  exportCalibration() { return structuredClone(this.calibration); }
  reset() { this.calibration = {}; this.onLearn(null, null); }
}

export function formatChord(hint) {
  if (!hint) return 'Unmapped';
  const parts = [];
  if (hint.altGraph) parts.push('AltGr');
  if (hint.shift) parts.push('Shift');
  parts.push(hint.code.replace(/^Key/, '').replace(/^Digit/, ''));
  return parts.join(' + ');
}

export function reverseMap(profileId) {
  const layout = LAYOUTS[profileId] || LAYOUTS['en-us'];
  const out = new Map();
  for (const [code, variants] of Object.entries(layout.map)) {
    variants.forEach((ch, index) => {
      if (!ch) return;
      out.set(ch, { code, shift:index === 1 || index === 3, altGraph:index >= 2 });
    });
  }
  return out;
}

export function reachableCharacters(profileId, calibration={}) {
  const chars = new Set(reverseMap(profileId).keys());
  Object.keys(calibration).forEach(ch => chars.add(ch));
  return chars;
}

export function keyboardSafe(text, profileId, calibration={}, {allowWhitespace=true}={}) {
  const reachable = reachableCharacters(profileId, calibration);
  const bad = [];
  for (const ch of Array.from(text)) {
    if (allowWhitespace && /\s/u.test(ch)) continue;
    if (!reachable.has(ch)) bad.push(ch);
  }
  return [...new Set(bad)];
}

export function chordIdentityFromEvent(event) { return chordKey(chordFromEvent(event)); }


const FINGER_BY_CODE = {
  Backquote:'Left pinky',Digit1:'Left pinky',KeyQ:'Left pinky',KeyA:'Left pinky',KeyZ:'Left pinky',Tab:'Left pinky',CapsLock:'Left pinky',ShiftLeft:'Left pinky',
  Digit2:'Left ring',KeyW:'Left ring',KeyS:'Left ring',KeyX:'Left ring',
  Digit3:'Left middle',KeyE:'Left middle',KeyD:'Left middle',KeyC:'Left middle',
  Digit4:'Left index',Digit5:'Left index',KeyR:'Left index',KeyT:'Left index',KeyF:'Left index',KeyG:'Left index',KeyV:'Left index',KeyB:'Left index',
  Digit6:'Right index',Digit7:'Right index',KeyY:'Right index',KeyU:'Right index',KeyH:'Right index',KeyJ:'Right index',KeyN:'Right index',KeyM:'Right index',
  Digit8:'Right middle',KeyI:'Right middle',KeyK:'Right middle',Comma:'Right middle',
  Digit9:'Right ring',KeyO:'Right ring',KeyL:'Right ring',Period:'Right ring',
  Digit0:'Right pinky',Minus:'Right pinky',Equal:'Right pinky',KeyP:'Right pinky',BracketLeft:'Right pinky',BracketRight:'Right pinky',Backslash:'Right pinky',Semicolon:'Right pinky',Quote:'Right pinky',Slash:'Right pinky',Enter:'Right pinky',ShiftRight:'Right pinky',Backspace:'Right pinky',
  Space:'Thumb'
};

export function fingerForCode(code) { return FINGER_BY_CODE[code] || ''; }
