import express from 'express';
import { pool } from '../db.js';
import { requireSuperuser } from '../middleware/admin.js';
import { DEFAULT_LEARNING_TOPICS, generateLearningArticle, getRelevantProducts, slugify } from '../services/learningCentreGenerator.js';
import { runLearningCentreAutomation } from '../services/learningCentreScheduler.js';
import { sendLearningCentreReportEmail } from '../services/learningCentreEmail.js';

export const router = express.Router();
const parseJson = (value, fallback = []) => { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } };
const present = (row) => row ? { ...row, product_links: parseJson(row.product_links), internal_links: parseJson(row.internal_links), references: parseJson(row.references) } : null;

router.get('/articles', async (_req, res) => {
  try {
    const result = await pool.query("SELECT id, title, slug, excerpt, meta_description, category, author_name, product_links, published_at, updated_at FROM learning_centre_articles WHERE status = 'published' AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC");
    res.json({ articles: result.rows.map(present) });
  } catch (error) { res.status(500).json({ error: 'Unable to load Learning Centre articles' }); }
});

router.get('/articles/:slug', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM learning_centre_articles WHERE slug = $1 AND status = 'published' AND published_at <= CURRENT_TIMESTAMP", [req.params.slug]);
    if (!result.rowCount) return res.status(404).json({ error: 'Article not found' });
    res.json({ article: present(result.rows[0]) });
  } catch (error) { res.status(500).json({ error: 'Unable to load this article' }); }
});

router.get('/admin/overview', requireSuperuser, async (_req, res) => {
  try {
    const [settings, topics, articles] = await Promise.all([
      pool.query('SELECT * FROM learning_centre_settings WHERE id = 1'),
      pool.query('SELECT * FROM learning_centre_topics ORDER BY status = \'queued\' DESC, priority ASC, id ASC'),
      pool.query('SELECT * FROM learning_centre_articles ORDER BY updated_at DESC LIMIT 100'),
    ]);
    res.json({ settings: settings.rows[0], topics: topics.rows, articles: articles.rows.map(present) });
  } catch (error) { res.status(500).json({ error: 'Unable to load Learning Centre dashboard' }); }
});

router.post('/admin/topics/seed', requireSuperuser, async (_req, res) => {
  try {
    for (const [title, searchQuestion, category] of DEFAULT_LEARNING_TOPICS) await pool.query('INSERT INTO learning_centre_topics (title, search_question, category) VALUES ($1,$2,$3) ON CONFLICT (title) DO NOTHING', [title, searchQuestion, category]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Unable to add starter topics' }); }
});

router.post('/admin/topics', requireSuperuser, async (req, res) => {
  const { title, searchQuestion = '', category = 'Parenting guides', priority = 100 } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'A topic title is required' });
  try { const result = await pool.query('INSERT INTO learning_centre_topics (title, search_question, category, priority) VALUES ($1,$2,$3,$4) RETURNING *', [String(title).trim(), String(searchQuestion).trim(), String(category).trim(), Number(priority) || 100]); res.status(201).json({ topic: result.rows[0] }); }
  catch (error) { res.status(400).json({ error: 'That topic already exists or could not be saved' }); }
});

router.post('/admin/topics/:id/generate', requireSuperuser, async (req, res) => {
  try {
    const topicResult = await pool.query('SELECT * FROM learning_centre_topics WHERE id = $1', [req.params.id]);
    if (!topicResult.rowCount) return res.status(404).json({ error: 'Topic not found' });
    const topic = topicResult.rows[0]; const products = await getRelevantProducts(pool, topic); const generated = await generateLearningArticle({ topic, products });
    let slug = generated.slug || slugify(generated.title); const match = await pool.query('SELECT 1 FROM learning_centre_articles WHERE slug = $1', [slug]); if (match.rowCount) slug = `${slug}-${Date.now().toString().slice(-5)}`;
    const result = await pool.query('INSERT INTO learning_centre_articles (topic_id,title,slug,excerpt,body_html,meta_title,meta_description,category,review_required,product_links,internal_links,references) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [topic.id, generated.title, slug, generated.excerpt, generated.bodyHtml, generated.metaTitle, generated.metaDescription, topic.category, generated.reviewRequired, JSON.stringify(products), '[]', '[]']);
    await pool.query("UPDATE learning_centre_topics SET status = 'used', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [topic.id]);
    const article = present(result.rows[0]); await sendLearningCentreReportEmail({ article, action: 'prepared as a draft', notes: article.review_required ? 'This topic needs human review before publishing.' : '' }).catch(() => {});
    res.status(201).json({ article, generatedWith: generated.generatedWith });
  } catch (error) { console.error('[learning-centre] generate:', error); res.status(500).json({ error: 'Unable to generate the draft' }); }
});

router.put('/admin/articles/:id', requireSuperuser, async (req, res) => {
  const { title, excerpt, bodyHtml, metaTitle, metaDescription, category, status, scheduledFor } = req.body || {};
  try {
    const result = await pool.query('UPDATE learning_centre_articles SET title=COALESCE($1,title), excerpt=COALESCE($2,excerpt), body_html=COALESCE($3,body_html), meta_title=COALESCE($4,meta_title), meta_description=COALESCE($5,meta_description), category=COALESCE($6,category), status=COALESCE($7,status), scheduled_for=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *', [title, excerpt, bodyHtml, metaTitle, metaDescription, category, status, scheduledFor || null, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Article not found' }); res.json({ article: present(result.rows[0]) });
  } catch (error) { res.status(500).json({ error: 'Unable to save the article' }); }
});

router.post('/admin/articles/:id/publish', requireSuperuser, async (req, res) => {
  try { const result = await pool.query("UPDATE learning_centre_articles SET status='published', published_at=CURRENT_TIMESTAMP, last_reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Article not found' }); res.json({ article: present(result.rows[0]) }); } catch { res.status(500).json({ error: 'Unable to publish the article' }); }
});
router.post('/admin/articles/:id/unpublish', requireSuperuser, async (req, res) => { try { const result = await pool.query("UPDATE learning_centre_articles SET status='draft', published_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.params.id]); if (!result.rowCount) return res.status(404).json({ error: 'Article not found' }); res.json({ article: present(result.rows[0]) }); } catch { res.status(500).json({ error: 'Unable to unpublish the article' }); } });
router.post('/admin/settings', requireSuperuser, async (req, res) => { const { automationEnabled, intervalDays, lowRiskAutoPublish } = req.body || {}; try { const result = await pool.query('UPDATE learning_centre_settings SET automation_enabled=$1, interval_days=$2, low_risk_auto_publish=$3, updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING *', [Boolean(automationEnabled), Math.min(30, Math.max(1, Number(intervalDays) || 5)), Boolean(lowRiskAutoPublish)]); res.json({ settings: result.rows[0] }); } catch { res.status(500).json({ error: 'Unable to save settings' }); } });
router.post('/admin/automation/run', requireSuperuser, async (_req, res) => { try { res.json(await runLearningCentreAutomation({ force: true })); } catch (error) { res.status(500).json({ error: error.message || 'Unable to run automation' }); } });

export default router;
