/**
 * Messages that end the automated conversation for good. Each entry is matched
 * as whole words against the normalised message, never as a substring:
 * substring matching opted leads out for "nonstop", "stopover" and "موقف"
 * (parking), which contain "stop" and "وقف".
 *
 * Arabic phrases list their feminine and plural forms explicitly because whole
 * word matching no longer catches them as a side effect.
 */
const OPT_OUT_PHRASES = [
  'stop',
  'unsubscribe',
  'الغاء',
  'وقف',
  'بلوك',
  'مش مهتم',
  'مش مهتمة',
  'مش مهتمين',
  'مش عايز',
  'مش عايزة',
  'مش عايزين',
].map((phrase) => tokens(phrase));

function normalise(text: string): string {
  return text
    .toLocaleLowerCase()
    // Arabic diacritics and tatweel carry no meaning for matching.
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي');
}

function tokens(text: string): string[] {
  return normalise(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function isNumber(token: string | undefined): boolean {
  return token !== undefined && /^\p{N}+$/u.test(token);
}

function containsPhraseAt(message: string[], phrase: string[], start: number): boolean {
  return phrase.every((word, offset) => message[start + offset] === word);
}

/**
 * A keyword followed straight away by a number is a reference, not a command:
 * "بلوك 3" is building block 3, not "block me".
 */
export function isOptOutMessage(text: string): boolean {
  const message = tokens(text);
  return OPT_OUT_PHRASES.some((phrase) => {
    for (let start = 0; start + phrase.length <= message.length; start += 1) {
      if (!containsPhraseAt(message, phrase, start)) continue;
      if (isNumber(message[start + phrase.length])) continue;
      return true;
    }
    return false;
  });
}
