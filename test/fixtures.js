// A fixed scoring configuration for the tests.
//
// The shipped defaults (src/core/settings.js) are a sample profile that users
// replace, so tests must not depend on them: changing a default should never
// break a test. This fixture starts from the defaults (home region, gates,
// keywords) and pins the values the scenarios below were written against.
import * as J from '../src/all.js';

export function testConfig() {
  let cfg = J.clone(J.DEFAULT_SETTINGS);
  cfg = J.setPath(cfg, 'gates.pay.floor', 125000);
  cfg = J.setPath(cfg, 'gates.pay.preferred', 135000);
  cfg = J.setPath(cfg, 'gates.product.knownProducts', cfg.gates.product.knownProducts.concat(['Wasabi', 'Arctic Wolf']));
  return cfg;
}
