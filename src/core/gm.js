// Violentmonkey injects GM_* as globals. These guards let the same modules load
// under Node (unit tests) where there is no GM storage.
/* global GM_getValue, GM_setValue */
export const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
export const getv = (key, fallback) => (hasGM ? GM_getValue(key, fallback) : fallback);
export const setv = (key, value) => { if (hasGM) GM_setValue(key, value); };

/* global GM_addValueChangeListener */
// Violentmonkey tells every tab when another tab saves a value, so each tab
// can keep its copy current instead of re-reading storage before each change.
export const canWatch = typeof GM_addValueChangeListener === 'function';

// Calls fn(newValue) when ANOTHER tab saves `key`; this tab's own saves are ignored.
export function onRemoteChange(key, fn) {
  if (!canWatch) return false;
  GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => { if (remote) fn(newValue); });
  return true;
}
