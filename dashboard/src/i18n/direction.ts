/**
 * Arabic (0600–06FF), Arabic Supplement (0750–077F), Arabic Extended-A
 * (08A0–08FF) and the Presentation Forms blocks.
 */
const ARABIC_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function isArabic(value: string): boolean {
  return ARABIC_RANGE.test(value);
}

/**
 * Direction of a free-text string, used to align message bubbles and answer
 * values. Conversation content is Arabic even when the interface is English,
 * so this is decided per string rather than per app.
 */
export function directionOf(value: string): 'rtl' | 'ltr' {
  return isArabic(value) ? 'rtl' : 'ltr';
}
