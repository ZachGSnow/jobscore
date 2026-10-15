// Closed vocabularies shared by the extraction schema, normalisation and gates.
export const BUYER_PERSONAS = ['it_admin', 'msp', 'it_director', 'mixed', 'exec', 'business_user', 'other'];
export const ROLE_TYPES = [
  'presales', 'implementation_or_professional_services', 'support',
  'customer_success_or_account_management', 'technical_account_manager',
  'sales_ae_or_quota', 'non_it', 'other',
];
export const WORK_ARRANGEMENTS = ['remote', 'hybrid_work', 'onsite', 'unclear'];
export const LOCATION_SCOPES = ['us_wide', 'us_region', 'named_place', 'non_us', 'unclear'];
export const ELIGIBILITY = ['yes', 'no', 'unclear'];
export const BASE_SOURCES = ['stated', 'derived_from_ote', 'not_stated'];
export const YEARS_KINDS = ['customer_facing_technical', 'presales_or_se', 'selling_or_quota', 'general_it', 'none'];
export const EMPLOYER_TYPES = ['direct', 'staffing_or_hidden_client'];
export const TRAVEL_SCOPES = ['none', 'home_region', 'other_region', 'unspecified'];
export const TRAVEL_PURPOSES = ['customer', 'company', 'both', 'unclear'];
export const REQUIREMENT_KINDS = ['required', 'preferred'];
