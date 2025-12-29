import crypto from 'crypto';
import { pool } from '../db.js';

// Compute deterministic hash of the source text to detect changes
export function hashText(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

// Fetch cached translation by pid + comment_id + source hash
export async function getCachedTranslation(pid, commentId, sourceText) {
  if (!pid || !commentId || !sourceText) return null;
  const sourceHash = hashText(sourceText);
  const { rows } = await pool.query(
    `SELECT translated_text, detected_lang FROM product_review_translations
     WHERE pid = $1 AND comment_id = $2 AND source_hash = $3
     LIMIT 1`,
    [pid, commentId, sourceHash]
  );
  if (!rows?.length) return null;
  return { translatedText: rows[0].translated_text, detectedLang: rows[0].detected_lang, sourceHash };
}

// Upsert translation so future requests reuse it
export async function saveTranslation(pid, commentId, sourceText, translatedText, detectedLang) {
  if (!pid || !commentId || !sourceText || !translatedText) return null;
  const sourceHash = hashText(sourceText);
  await pool.query(
    `INSERT INTO product_review_translations (pid, comment_id, source_hash, translated_text, detected_lang)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (pid, comment_id, source_hash)
     DO UPDATE SET translated_text = EXCLUDED.translated_text,
                   detected_lang = EXCLUDED.detected_lang,
                   updated_at = NOW();`,
    [pid, commentId, sourceHash, translatedText, detectedLang || null]
  );
  return { translatedText, sourceHash, detectedLang: detectedLang || null };
}
