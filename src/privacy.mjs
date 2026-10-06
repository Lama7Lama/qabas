// A contact-data guard, not an anonymizer. Names and sensitive details can escape it.
export const normalizeDigits = text => text.replace(/[٠-٩۰-۹]/gu, digit => String(
  '٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)
));
export function hasContactData(text) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+|https?:\/\/|(?:\d[\s()+.\-]*){9,}/iu.test(normalizeDigits(text));
}
export function payloadHasContactData(value) {
  if (typeof value === 'string') return hasContactData(value);
  return !!value && typeof value === 'object' && Object.values(value).some(payloadHasContactData);
}
