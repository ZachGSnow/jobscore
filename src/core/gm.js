// Violentmonkey injects GM_* as globals. These guards let the same modules load
// under Node (unit tests) where there is no GM storage.
/* global GM_getValue, GM_setValue */
export const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
export const getv = (key, fallback) => (hasGM ? GM_getValue(key, fallback) : fallback);
export const setv = (key, value) => { if (hasGM) GM_setValue(key, value); };
