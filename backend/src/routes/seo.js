import express from 'express';
import { pool } from '../db.js';

export const router = express.Router();

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'https://snuggleup.co.za').replace(/\/+$/, '');
}

function getBackendUrl() {
  return (process.env.BACKEND_URL || 'https://api.snuggleup.co.za').replace(/\/+$/, '');
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function dateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function sitemapUrl({ loc, lastmod, changefreq = 'weekly', priority = '0.7' }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    `    <changefreq>${escapeXml(changefreq)}</changefreq>`,
    `    <priority>${escapeXml(priority)}</priority>`,
    '  </url>',
  ].join('\n');
}

router.get('/robots.txt', (_req, res) => {
  const frontendUrl = getFrontendUrl();
  const backendUrl = getBackendUrl();
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/admin',
    'Disallow: /api/cart',
    'Disallow: /api/orders',
    '',
    `Sitemap: ${frontendUrl}/sitemap.xml`,
    `Sitemap: ${backendUrl}/sitemap.xml`,
  ].join('\n'));
});

router.get('/sitemap.xml', async (_req, res) => {
  const frontendUrl = getFrontendUrl();
  const today = dateOnly();
  const urls = [
    { loc: `${frontendUrl}/`, lastmod: today, changefreq: 'daily', priority: '1.0' },
    { loc: `${frontendUrl}/shipping`, lastmod: today, changefreq: 'monthly', priority: '0.5' },
    { loc: `${frontendUrl}/returns`, lastmod: today, changefreq: 'monthly', priority: '0.5' },
    { loc: `${frontendUrl}/privacy`, lastmod: today, changefreq: 'yearly', priority: '0.3' },
    { loc: `${frontendUrl}/terms`, lastmod: today, changefreq: 'yearly', priority: '0.3' },
    { loc: `${frontendUrl}/data-deletion`, lastmod: today, changefreq: 'yearly', priority: '0.2' },
  ];

  try {
    const curated = await pool.query(`
      SELECT id, COALESCE(seo_title, product_name) AS title, updated_at, created_at
      FROM curated_products
      WHERE is_active = TRUE
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 5000
    `);

    curated.rows.forEach((product) => {
      const slug = slugify(product.title || 'baby-product');
      urls.push({
        loc: `${frontendUrl}/products/${product.id}/${slug}`,
        lastmod: dateOnly(product.updated_at || product.created_at),
        changefreq: 'weekly',
        priority: '0.8',
      });
    });

    const localProducts = await pool.query(`
      SELECT id, name, updated_at, created_at
      FROM local_products
      WHERE is_active = TRUE
        AND approval_status = 'approved'
      ORDER BY is_featured DESC, updated_at DESC NULLS LAST, created_at DESC
      LIMIT 5000
    `);

    localProducts.rows.forEach((product) => {
      const slug = slugify(product.name || 'local-baby-product');
      urls.push({
        loc: `${frontendUrl}/local-products/${product.id}/${slug}`,
        lastmod: dateOnly(product.updated_at || product.created_at),
        changefreq: 'weekly',
        priority: '0.85',
      });
    });
  } catch (error) {
    console.error('Failed to build product sitemap:', error.message);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(sitemapUrl),
    '</urlset>',
  ].join('\n');

  res.type('application/xml').send(xml);
});

export default router;
