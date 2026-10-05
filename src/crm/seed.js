/**
 * Sample data for the demo account. Loaded fresh on every page load.
 *
 * Phone numbers come from the ranges the Australian Communications and Media
 * Authority reserves for fiction (0491 570 xxx mobiles, 02 5550 xxxx landlines),
 * and email addresses use the reserved example.* domains.
 */
export const seed = {
  account: {
    businessName: 'Saltbush Studio',
    clientContactNumber: '02 5550 4417',
    billingEmail: 'accounts@saltbush.example.com',
    currency: 'AUD',
    timeZone: 'Australia/Sydney',
  },

  customFields: [
    { id: 'cf_pref', label: 'Preferred contact method', appliesTo: 'contacts', type: 'dropdown', options: ['Email', 'Phone', 'SMS'] },
    { id: 'cf_abn', label: 'ABN', appliesTo: 'companies', type: 'text', options: [] },
    { id: 'cf_source', label: 'Lead source', appliesTo: 'deals', type: 'dropdown', options: ['Referral', 'Website', 'Event', 'Cold outreach'] },
  ],

  companies: [
    { id: 'co_1', name: 'Fernhill Dental', industry: 'Healthcare', phone: '02 5550 1203', website: 'fernhill.example.com', address: '12 Albion St, Surry Hills NSW 2010', custom: { cf_abn: '51 824 753 556' } },
    { id: 'co_2', name: 'Kestrel Logistics', industry: 'Transport', phone: '02 5550 8841', website: 'kestrel.example.net', address: '4 Dock Rd, Port Botany NSW 2036', custom: { cf_abn: '33 102 417 932' } },
    { id: 'co_3', name: 'Marlowe & Finch Legal', industry: 'Professional services', phone: '02 5550 2290', website: 'marlowefinch.example.org', address: 'Level 9, 60 Margaret St, Sydney NSW 2000', custom: {} },
    { id: 'co_4', name: 'Tidewater Brewing Co.', industry: 'Hospitality', phone: '02 5550 7316', website: 'tidewater.example.com', address: '88 Parramatta Rd, Camperdown NSW 2050', custom: { cf_abn: '87 650 211 004' } },
    { id: 'co_5', name: 'Northshore Physio', industry: 'Healthcare', phone: '02 5550 6672', website: 'northshorephysio.example.net', address: '3/21 Military Rd, Neutral Bay NSW 2089', custom: {} },
  ],

  contacts: [
    { id: 'ct_1', firstName: 'Priya', lastName: 'Raman', email: 'priya.raman@fernhill.example.com', phone: '0491 570 156', jobTitle: 'Practice manager', companyId: 'co_1', status: 'customer', custom: { cf_pref: 'Email' } },
    { id: 'ct_2', firstName: 'Tom', lastName: 'Okafor', email: 'tom@kestrel.example.net', phone: '0491 570 157', jobTitle: 'Operations director', companyId: 'co_2', status: 'customer', custom: { cf_pref: 'Phone' } },
    { id: 'ct_3', firstName: 'Grace', lastName: 'Lindqvist', email: 'glindqvist@marlowefinch.example.org', phone: '0491 570 158', jobTitle: 'Partner', companyId: 'co_3', status: 'lead', custom: {} },
    { id: 'ct_4', firstName: 'Mateo', lastName: 'Silva', email: 'mateo@tidewater.example.com', phone: '0491 570 159', jobTitle: 'Head brewer', companyId: 'co_4', status: 'customer', custom: { cf_pref: 'SMS' } },
    { id: 'ct_5', firstName: 'Hannah', lastName: 'Cho', email: 'hannah.cho@tidewater.example.com', phone: '0491 570 110', jobTitle: 'Marketing lead', companyId: 'co_4', status: 'lead', custom: {} },
    { id: 'ct_6', firstName: 'Daniel', lastName: 'Whitaker', email: 'dan@northshorephysio.example.net', phone: '0491 570 313', jobTitle: 'Owner', companyId: 'co_5', status: 'lead', custom: { cf_pref: 'Phone' } },
    { id: 'ct_7', firstName: 'Aroha', lastName: 'Ngata', email: 'aroha.ngata@example.com', phone: '0491 570 737', jobTitle: 'Freelance producer', companyId: null, status: 'inactive', custom: {} },
    { id: 'ct_8', firstName: 'Liam', lastName: 'Brennan', email: 'liam.brennan@kestrel.example.net', phone: '0491 571 266', jobTitle: 'Procurement officer', companyId: 'co_2', status: 'lead', custom: { cf_pref: 'Email' } },
  ],

  deals: [
    { id: 'dl_1', name: 'Fernhill brand refresh', value: 18500, companyId: 'co_1', contactId: 'ct_1', stage: 'proposal', closeDate: '2026-11-14', lostReason: null, custom: { cf_source: 'Referral' } },
    { id: 'dl_2', name: 'Kestrel fleet livery', value: 42000, companyId: 'co_2', contactId: 'ct_2', stage: 'negotiation', closeDate: '2026-10-31', lostReason: null, custom: { cf_source: 'Event' } },
    { id: 'dl_3', name: 'Marlowe & Finch website', value: 26000, companyId: 'co_3', contactId: 'ct_3', stage: 'qualified', closeDate: '2026-12-05', lostReason: null, custom: { cf_source: 'Website' } },
    { id: 'dl_4', name: 'Tidewater can labels: winter range', value: 9800, companyId: 'co_4', contactId: 'ct_4', stage: 'won', closeDate: '2026-09-18', lostReason: null, custom: { cf_source: 'Referral' } },
    { id: 'dl_5', name: 'Tidewater taproom signage', value: 7400, companyId: 'co_4', contactId: 'ct_5', stage: 'new', closeDate: '2026-12-12', lostReason: null, custom: {} },
    { id: 'dl_6', name: 'Northshore Physio booking site', value: 12000, companyId: 'co_5', contactId: 'ct_6', stage: 'lost', closeDate: '2026-09-02', lostReason: 'Price', custom: { cf_source: 'Cold outreach' } },
    { id: 'dl_7', name: 'Kestrel safety campaign', value: 15500, companyId: 'co_2', contactId: 'ct_8', stage: 'new', closeDate: '2027-01-30', lostReason: null, custom: { cf_source: 'Website' } },
  ],

  notes: [
    { id: 'nt_1', contactId: 'ct_1', createdAt: '2026-09-24T10:12:00+10:00', text: 'Sent revised proposal with two logo directions. Decision expected after their October partners meeting.' },
    { id: 'nt_2', contactId: 'ct_1', createdAt: '2026-09-10T15:40:00+10:00', text: 'Discovery call. Wants signage, stationery and a refreshed website header.' },
    { id: 'nt_3', contactId: 'ct_2', createdAt: '2026-09-29T09:05:00+10:00', text: 'Negotiating print run size for 40 trucks. Asked for staged invoicing.' },
    { id: 'nt_4', contactId: 'ct_6', createdAt: '2026-09-02T11:30:00+10:00', text: 'Went with a cheaper template-based provider. Revisit in Q2.' },
  ],
};

export const STATUSES = [
  { value: 'lead', label: 'Lead' },
  { value: 'customer', label: 'Customer' },
  { value: 'inactive', label: 'Inactive' },
];

export const OPEN_STAGES = [
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal sent' },
  { value: 'negotiation', label: 'Negotiation' },
];

export const STAGES = [...OPEN_STAGES, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }];

export const LOST_REASONS = ['Price', 'Timing', 'Chose a competitor', 'No response', 'Other'];

export const INDUSTRIES = ['Healthcare', 'Hospitality', 'Professional services', 'Retail', 'Transport', 'Technology', 'Other'];

export const CURRENCIES = ['AUD', 'NZD', 'USD', 'GBP', 'EUR'];

export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
];

export const APPLIES_TO = [
  { value: 'contacts', label: 'Contacts' },
  { value: 'companies', label: 'Companies' },
  { value: 'deals', label: 'Deals' },
];
