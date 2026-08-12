import test from 'node:test';
import assert from 'node:assert/strict';
import {
  municipalityFromCity,
  normalizeProvinceName,
  requestAnalyticsLocation,
} from '../src/services/analyticsLocation.js';

const requestWithHeaders = (headers) => ({
  get(name) {
    return headers[String(name).toLowerCase()];
  },
});

test('South African province codes are expanded', () => {
  assert.equal(normalizeProvinceName('GP', 'ZA'), 'Gauteng');
  assert.equal(normalizeProvinceName('WC', 'ZA'), 'Western Cape');
});

test('major South African cities are mapped to their metro municipality', () => {
  assert.equal(
    municipalityFromCity('Johannesburg', 'ZA'),
    'City of Johannesburg Metropolitan Municipality'
  );
  assert.equal(municipalityFromCity('Polokwane', 'ZA'), 'Polokwane');
});

test('Cloudflare location headers produce explicit analytics fields', () => {
  const result = requestAnalyticsLocation(requestWithHeaders({
    'cf-ipcountry': 'ZA',
    'cf-region': 'Gauteng',
    'cf-ipcity': 'Johannesburg',
  }));

  assert.deepEqual(result, {
    countryCode: 'ZA',
    cityName: 'Johannesburg',
    regionName: 'Gauteng',
    provinceName: 'Gauteng',
    municipalityName: 'City of Johannesburg Metropolitan Municipality',
  });
});

test('Vercel URL-encoded city and province code headers are normalized', () => {
  const result = requestAnalyticsLocation(requestWithHeaders({
    'x-vercel-ip-country': 'ZA',
    'x-vercel-ip-country-region': 'WC',
    'x-vercel-ip-city': 'Cape%20Town',
  }));

  assert.equal(result.provinceName, 'Western Cape');
  assert.equal(result.cityName, 'Cape Town');
  assert.equal(result.municipalityName, 'City of Cape Town Metropolitan Municipality');
});
