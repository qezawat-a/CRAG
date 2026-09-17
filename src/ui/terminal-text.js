const LETTERS = {
  'ا': 'a', 'آ': 'aa', 'أ': 'a', 'إ': 'e', 'ٱ': 'a',
  'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch',
  'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
  'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't',
  'ظ': 'z', 'ع': "'", 'غ': 'gh', 'ف': 'f', 'ق': 'gh', 'ک': 'k',
  'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'و': 'v',
  'ؤ': 'o', 'ه': 'h', 'ۀ': 'he', 'ة': 'h', 'ی': 'y', 'ي': 'y',
  'ى': 'y', 'ئ': 'y', 'ء': "'", 'َ': 'a', 'ِ': 'e', 'ُ': 'o',
  'ً': 'an', 'ٍ': 'en', 'ٌ': 'on', 'ّ': '', 'ْ': '', 'ـ': '',
  '،': ',', '؛': ';', '؟': '?', '٪': '%', '٫': '.', '٬': ',',
};

export function terminalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/[\u200c\u200d]/gu, ' ')
    .replace(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/gu, (char) => {
      const code = char.codePointAt(0);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      return LETTERS[char] ?? `\\u${code.toString(16).padStart(4, '0')}`;
    });
}
