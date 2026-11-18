const ARABIC_TO_PERSIAN = new Map([
  ['ي', 'ی'], ['ى', 'ی'], ['ئ', 'ئ'], ['ك', 'ک'], ['ة', 'ه'], ['ۀ', 'هٔ']
]);

export const PERSIAN_DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
export const PERSIAN_LETTER_RE = /[\u0600-\u06FF]/u;
export const LATIN_LETTER_RE = /[A-Za-z]/u;

export function normalizePersian(text) {
  let out = String(text ?? '').normalize('NFC');
  out = Array.from(out, ch => ARABIC_TO_PERSIAN.get(ch) ?? ch).join('');
  return out
    .replace(/\u0640/gu, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '');
}

export function sanitizePracticeText(text, {
  language = 'en',
  allowDiacritics = false,
  collapseWhitespace = true
} = {}) {
  let out = String(text ?? '').normalize('NFC');
  if (language === 'fa') out = normalizePersian(out);
  if (language === 'fa' && !allowDiacritics) out = out.replace(PERSIAN_DIACRITICS_RE, '');
  out = out.replace(/\r\n?/g, '\n');
  if (collapseWhitespace) {
    out = out.replace(/[\t\v\f]+/g, ' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  }
  return out.trim();
}

export function normalizeForComparison(value, language = 'en') {
  const text = String(value ?? '').normalize('NFC');
  return language === 'fa' ? normalizePersian(text) : text;
}

export function graphemes(text, locale = 'en') {
  const source=String(text);
  let units;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(locale === 'fa' ? 'fa' : 'en', { granularity: 'grapheme' });
    units=[...segmenter.segment(source)].map(x => x.segment);
  } else {
    units=Array.from(source);
  }

  // Intl.Segmenter correctly treats ZWNJ/ZWJ as part of the surrounding
  // grapheme for *display*.  A typing trainer has a different requirement:
  // نیم‌فاصله is produced by its own physical chord (Shift+Space on ir/pes),
  // so it must be one independently typeable unit.  Split join controls out
  // without breaking combining-mark graphemes.
  if(locale==='fa'){
    const typingUnits=[];
    for(const unit of units){
      if(!/[‌‍]/u.test(unit)){ typingUnits.push(unit); continue; }
      let buffer='';
      for(const ch of Array.from(unit)){
        if(ch==='‌' || ch==='‍'){
          if(buffer) typingUnits.push(buffer);
          typingUnits.push(ch);
          buffer='';
        }else buffer+=ch;
      }
      if(buffer) typingUnits.push(buffer);
    }
    return typingUnits;
  }
  return units;
}

export function scriptStats(text) {
  const chars = graphemes(text).filter(ch => /\S/u.test(ch));
  let persian = 0;
  let latin = 0;
  let letters = 0;
  for (const ch of chars) {
    if (PERSIAN_LETTER_RE.test(ch) && /[\u0621-\u063A\u0641-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC]/u.test(ch)) {
      persian += 1;
      letters += 1;
    } else if (LATIN_LETTER_RE.test(ch)) {
      latin += 1;
      letters += 1;
    }
  }
  return {
    persian,
    latin,
    letters,
    persianRatio: letters ? persian / letters : 0,
    latinRatio: letters ? latin / letters : 0
  };
}

export function isPersianDiacritic(ch) {
  return new RegExp(PERSIAN_DIACRITICS_RE.source,'u').test(ch);
}


export function cleanImportedText(text, language, options = {}) {
  let out = sanitizePracticeText(text, { language, allowDiacritics: !!options.allowDiacritics });
  if (language === 'fa') {
    out = out
      .replace(/\s+([،؛؟.!])/g, '$1')
      .replace(/([،؛؟])(?=\S)/g, '$1 ');
  } else {
    out = out.replace(/\s+([,;:?!\.])/g, '$1').replace(/([,;:?!\.])(?=[A-Za-z])/g, '$1 ');
  }
  return out;
}
