/** Room text: the keys themselves, so a missing translation can't pass silently in a state test. */
export const tr = new Proxy({}, { get: (_, key) => String(key) });
export const dateLocale = () => "en-GB";
