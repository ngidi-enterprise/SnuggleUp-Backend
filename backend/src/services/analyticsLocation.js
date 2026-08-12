const SOUTH_AFRICAN_PROVINCES = new Map([
  ['EC', 'Eastern Cape'],
  ['FS', 'Free State'],
  ['GP', 'Gauteng'],
  ['KZN', 'KwaZulu-Natal'],
  ['LP', 'Limpopo'],
  ['MP', 'Mpumalanga'],
  ['NC', 'Northern Cape'],
  ['NW', 'North West'],
  ['WC', 'Western Cape'],
]);

const SOUTH_AFRICAN_METROS = [
  { pattern: /^(johannesburg|sandton|soweto|randburg|roodepoort|midrand)$/i, name: 'City of Johannesburg Metropolitan Municipality' },
  { pattern: /^(pretoria|tshwane|centurion|akasia|soshanguve|mamelodi)$/i, name: 'City of Tshwane Metropolitan Municipality' },
  { pattern: /^(germiston|boksburg|benoni|kempton park|alberton|springs|edenvale|brakpan|nigel)$/i, name: 'City of Ekurhuleni Metropolitan Municipality' },
  { pattern: /^(cape town|bellville|durbanville|somerset west|strand)$/i, name: 'City of Cape Town Metropolitan Municipality' },
  { pattern: /^(durban|umhlanga|pinetown|westville|amanzimtoti)$/i, name: 'eThekwini Metropolitan Municipality' },
  { pattern: /^(gqeberha|port elizabeth|uitenhage|kariega|despatch)$/i, name: 'Nelson Mandela Bay Metropolitan Municipality' },
  { pattern: /^(east london|bhisho|bisho|king william'?s town|qonce)$/i, name: 'Buffalo City Metropolitan Municipality' },
  { pattern: /^(bloemfontein|botshabelo|thaba nchu)$/i, name: 'Mangaung Metropolitan Municipality' },
];

const cleanHeader = (value, maxLength = 120) => {
  if (!value) return null;
  const firstValue = Array.isArray(value) ? value[0] : String(value).split(',')[0];
  let decoded = firstValue;
  try {
    decoded = decodeURIComponent(firstValue);
  } catch {
    // Some proxy headers contain a literal percent sign rather than URL encoding.
  }
  const cleaned = String(decoded).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return cleaned || null;
};

const firstHeader = (req, names) => {
  for (const name of names) {
    const value = cleanHeader(req.get(name));
    if (value) return value;
  }
  return null;
};

export const normalizeProvinceName = (value, countryCode) => {
  const cleaned = cleanHeader(value);
  if (!cleaned) return null;
  if (countryCode === 'ZA') {
    const compactCode = cleaned.toUpperCase().replace(/[^A-Z]/g, '');
    return SOUTH_AFRICAN_PROVINCES.get(compactCode) || cleaned;
  }
  return cleaned;
};

export const municipalityFromCity = (cityName, countryCode) => {
  const city = cleanHeader(cityName);
  if (!city) return null;
  if (countryCode !== 'ZA') return city;
  return SOUTH_AFRICAN_METROS.find((metro) => metro.pattern.test(city))?.name || city;
};

export const requestAnalyticsLocation = (req) => {
  const rawCountryCode = firstHeader(req, [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'cloudfront-viewer-country',
    'x-country-code',
  ]);
  const countryCode = /^[A-Z]{2}$/.test(String(rawCountryCode || '').toUpperCase())
    && !['XX', 'T1'].includes(String(rawCountryCode).toUpperCase())
    ? String(rawCountryCode).toUpperCase()
    : null;
  const cityName = firstHeader(req, [
    'cf-ipcity',
    'x-vercel-ip-city',
    'cloudfront-viewer-city',
    'x-client-city',
    'x-city',
  ]);
  const rawProvince = firstHeader(req, [
    'cf-region',
    'x-vercel-ip-country-region',
    'cloudfront-viewer-country-region-name',
    'cloudfront-viewer-country-region',
    'x-client-region',
    'x-region',
  ]);
  const explicitMunicipality = firstHeader(req, ['x-client-municipality', 'x-municipality']);
  const provinceName = normalizeProvinceName(rawProvince, countryCode);
  const municipalityName = explicitMunicipality || municipalityFromCity(cityName, countryCode);

  return {
    countryCode,
    cityName,
    regionName: rawProvince,
    provinceName,
    municipalityName,
  };
};
