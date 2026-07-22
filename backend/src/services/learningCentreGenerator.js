import OpenAI from 'openai';

export const DEFAULT_LEARNING_TOPICS = [
  ['Newborn checklist: what you actually need before baby arrives', 'newborn checklist South Africa', 'Newborn preparation'],
  ['Hospital bag checklist for South African parents', 'hospital bag checklist South Africa', 'Newborn preparation'],
  ['A first-time dad guide for the first few weeks at home', 'first time dad guide newborn', 'Newborn preparation'],
  ['How many nappies does a baby use by age?', 'how many nappies does a baby use', 'Everyday baby care'],
  ['How to prepare a calm, practical nursery', 'how to prepare a nursery', 'Nursery and home'],
  ['Thoughtful baby shower gift ideas parents will use', 'best baby shower gifts South Africa', 'Gifts and occasions'],
  ['A gentle guide to introducing solids', 'introducing solids guide', 'Feeding'],
  ['Baby sleep routines by age: a flexible guide', 'baby sleep schedule by age', 'Sleep'],
  ['Car seat safety basics for new parents', 'car seat safety South Africa', 'Safety and travel'],
  ['Understanding baby growth milestones without the pressure', 'baby growth milestones guide', 'Development'],
];

export const slugify = (value = '') => String(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
const escapeHtml = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const frontendUrl = () => (process.env.FRONTEND_URL || 'https://snuggleup.co.za').replace(/\/+$/, '');

export const needsHumanReview = (value = '') => /health|safety|sleep|solid|car seat|milestone|allerg|illness|chok|feed/i.test(value);

const keywords = (value = '') => new Set(String(value).toLowerCase().match(/[a-z]{4,}/g) || []);
const productUrl = (product) => `${frontendUrl()}${product.source === 'local' ? '/local-products' : '/products'}/${product.id}/${slugify(product.name)}`;

export async function getRelevantProducts(pool, topic) {
  const [local, curated] = await Promise.all([
    pool.query(`SELECT id::text, name, description, category, price, stock_quantity, images[1] AS image, 'local' AS source FROM local_products WHERE is_active = TRUE AND approval_status = 'approved' AND stock_quantity > 0 LIMIT 160`),
    pool.query(`SELECT id::text, COALESCE(seo_title, product_name) AS name, product_description AS description, category, COALESCE(custom_price, suggested_price) AS price, stock_quantity, product_image AS image, 'curated' AS source FROM curated_products WHERE is_active = TRUE AND stock_quantity > 0 LIMIT 160`),
  ]);
  const topicWords = keywords(`${topic.title} ${topic.search_question || ''} ${topic.category || ''}`);
  return [...local.rows, ...curated.rows]
    .map((item) => ({ ...item, score: [...keywords(`${item.name} ${item.description || ''} ${item.category || ''}`)].filter((word) => topicWords.has(word)).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => ({ ...item, url: productUrl(item) }));
}

const buildFallback = (topic, products) => {
  const safeTitle = escapeHtml(topic.title);
  const productSection = products.length
    ? `<h2>Helpful items to consider</h2><p>Every family has different needs. These are a few relevant items you can explore when they suit your routine.</p><ul>${products.map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a></li>`).join('')}</ul>`
    : '';
  return {
    title: topic.title,
    slug: slugify(topic.title),
    excerpt: `A calm, practical SnuggleUp guide to ${topic.title.toLowerCase()}.`,
    metaTitle: `${topic.title} | SnuggleUp Learning Centre`,
    metaDescription: `A helpful guide for South African parents: ${topic.title}.`,
    bodyHtml: `<p>Parenting brings plenty of decisions, and it helps to take things one small step at a time. This guide is here to make ${safeTitle.toLowerCase()} feel a little more manageable.</p><h2>Start with what matters most</h2><p>Begin with the basics, keep your own family routine in mind, and leave room to adjust as you learn what works. A simple plan is often more useful than a perfect one.</p><h2>Keep it practical</h2><ul><li>Make a short list and focus on your immediate needs.</li><li>Ask a trusted healthcare professional when you need medical or safety advice.</li><li>Choose products for usefulness and comfort, not pressure.</li></ul>${productSection}<h2>A gentle reminder</h2><p>You do not need to have every answer today. Small preparations can create a calmer start for you and your family.</p>`,
  };
};

const safeFromAi = (value, topic, products) => {
  const title = String(value?.title || topic.title).slice(0, 150);
  const sections = Array.isArray(value?.sections) ? value.sections.slice(0, 8) : [];
  const sectionHtml = sections.map((section) => `<h2>${escapeHtml(section.heading || 'Helpful guidance')}</h2>${(Array.isArray(section.paragraphs) ? section.paragraphs : [section.text]).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}${Array.isArray(section.bullets) && section.bullets.length ? `<ul>${section.bullets.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`).join('');
  if (!sectionHtml) return buildFallback(topic, products);
  const productHtml = products.length ? `<h2>Helpful items to consider</h2><p>Only choose what is genuinely useful for your family.</p><ul>${products.map((item) => `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a></li>`).join('')}</ul>` : '';
  return { title, slug: slugify(value?.slug || title), excerpt: String(value?.excerpt || `A practical guide to ${title.toLowerCase()}.`).slice(0, 300), metaTitle: String(value?.metaTitle || `${title} | SnuggleUp Learning Centre`).slice(0, 70), metaDescription: String(value?.metaDescription || `A helpful guide for South African parents: ${title}.`).slice(0, 160), bodyHtml: `<p>${escapeHtml(value?.intro || 'A practical, caring guide from SnuggleUp for parents and caregivers.')}</p>${sectionHtml}${productHtml}` };
};

export async function generateLearningArticle({ topic, products }) {
  const risk = needsHumanReview(`${topic.title} ${topic.search_question || ''} ${topic.category || ''}`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ...buildFallback(topic, products), reviewRequired: risk, generatedWith: 'starter-template' };
  try {
    const client = new OpenAI({ apiKey });
    const productContext = products.map((item) => ({ name: item.name, category: item.category })).slice(0, 2);
    const prompt = `Write an original, genuinely helpful Learning Centre article for South African parents. Topic: ${topic.title}. Search question: ${topic.search_question || topic.title}. Category: ${topic.category || 'Parenting guides'}. Use a warm practical voice. Do not copy sources, invent statistics, medical claims, certifications, testimonials, or reviews. Do not keyword-stuff. At most two product mentions, only as optional, relevant suggestions. For safety, feeding, sleep, development or health topics, include a gentle note to seek qualified professional advice where appropriate. Return JSON only with title, slug, excerpt, metaTitle, metaDescription, intro, sections [{heading, paragraphs, bullets}]. Available products: ${JSON.stringify(productContext)}.`;
    const completion = await client.chat.completions.create({ model: process.env.LEARNING_CENTRE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.65, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    return { ...safeFromAi(parsed, topic, products), reviewRequired: risk, generatedWith: 'openai' };
  } catch (error) {
    console.error('[learning-centre] AI generation failed:', error.message);
    return { ...buildFallback(topic, products), reviewRequired: risk, generatedWith: 'starter-template' };
  }
}
