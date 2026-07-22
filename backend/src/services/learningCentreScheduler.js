import { pool } from '../db.js';
import { generateLearningArticle, getRelevantProducts } from './learningCentreGenerator.js';
import { sendLearningCentreReportEmail } from './learningCentreEmail.js';

let running = false;

export async function runLearningCentreAutomation({ force = false } = {}) {
  if (running) return { skipped: true, reason: 'A Learning Centre run is already in progress' };
  running = true;
  try {
    const settingsResult = await pool.query('SELECT * FROM learning_centre_settings WHERE id = 1');
    const settings = settingsResult.rows[0] || { automation_enabled: false, interval_days: 5, low_risk_auto_publish: false };
    if (!force && !settings.automation_enabled) return { skipped: true, reason: 'Automation is paused' };
    const intervalMs = Math.max(1, Number(settings.interval_days || 5)) * 24 * 60 * 60 * 1000;
    if (!force && settings.last_automation_run_at && Date.now() - new Date(settings.last_automation_run_at).getTime() < intervalMs) {
      return { skipped: true, reason: 'The next scheduled run is not due yet' };
    }
    const topicResult = await pool.query("SELECT * FROM learning_centre_topics WHERE status = 'queued' ORDER BY priority ASC, id ASC LIMIT 1");
    const topic = topicResult.rows[0];
    if (!topic) return { skipped: true, reason: 'No queued topics are waiting' };
    const products = await getRelevantProducts(pool, topic);
    const generated = await generateLearningArticle({ topic, products });
    let slug = generated.slug;
    const existing = await pool.query('SELECT 1 FROM learning_centre_articles WHERE slug = $1', [slug]);
    if (existing.rowCount) slug = `${slug}-${Date.now().toString().slice(-5)}`;
    const shouldPublish = Boolean(settings.low_risk_auto_publish) && !generated.reviewRequired;
    const status = shouldPublish ? 'published' : 'draft';
    const articleResult = await pool.query(`INSERT INTO learning_centre_articles (topic_id, title, slug, excerpt, body_html, meta_title, meta_description, category, status, review_required, published_at, product_links, internal_links, references) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9 = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END,$11,$12,$13) RETURNING *`, [topic.id, generated.title, slug, generated.excerpt, generated.bodyHtml, generated.metaTitle, generated.metaDescription, topic.category, status, generated.reviewRequired, JSON.stringify(products), JSON.stringify([]), JSON.stringify([])]);
    const article = articleResult.rows[0];
    await pool.query("UPDATE learning_centre_topics SET status = 'used', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [topic.id]);
    await pool.query('UPDATE learning_centre_settings SET last_automation_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1');
    await sendLearningCentreReportEmail({ article, action: status === 'published' ? 'published automatically' : 'prepared as a draft', notes: generated.reviewRequired ? 'This topic requires your human review before it can be published.' : '' }).catch((error) => console.error('[learning-centre] report email failed:', error.message));
    return { success: true, article, topic, products, generatedWith: generated.generatedWith };
  } finally { running = false; }
}

export function startLearningCentreScheduler() {
  if (process.env.LEARNING_CENTRE_SCHEDULER_DISABLED === 'true') return;
  setTimeout(() => runLearningCentreAutomation().catch((error) => console.error('[learning-centre] scheduled run failed:', error.message)), 20000);
  setInterval(() => runLearningCentreAutomation().catch((error) => console.error('[learning-centre] scheduled run failed:', error.message)), 6 * 60 * 60 * 1000);
  console.log('Learning Centre scheduler is active; it checks every 6 hours.');
}
