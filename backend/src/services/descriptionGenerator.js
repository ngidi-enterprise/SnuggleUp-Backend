import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

let claudeClient = null;
let geminiClient = null;

// Initialize Claude client if API key available
if (CLAUDE_API_KEY) {
  claudeClient = new Anthropic({ apiKey: CLAUDE_API_KEY });
}

// Initialize Gemini client if API key available
if (GEMINI_API_KEY) {
  geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
}

/**
 * Generate product description using Claude Vision
 * @param {string} productName - Product name
 * @param {string} imageBase64 - Base64 encoded image data (without data URI prefix)
 * @param {string} imageMimeType - MIME type of image (e.g., "image/jpeg")
 * @returns {Promise<string>} Generated description
 */
async function generateDescriptionWithClaude(productName, imageBase64, imageMimeType = 'image/jpeg') {
  if (!claudeClient) {
    throw new Error('Claude API not configured. Set CLAUDE_API_KEY environment variable.');
  }

  const prompt = `You are a product description writer for SnuggleUp, a South African e-commerce store specializing in baby products.

Generate a compelling, SEO-optimized product description for: "${productName}"

Based on the product image provided, create a description that:

1. **Captivates parents**: Start with a hook that speaks to parent concerns (safety, comfort, convenience, quality)
2. **Describes visible features**: Detail what you see in the image (materials, colors, design, construction)
3. **Highlights benefits**: Translate features into benefits (e.g., "soft cotton" → "gentle on sensitive baby skin")
4. **Includes age recommendations**: Add appropriate age ranges if visible
5. **Mentions safety/quality**: Any safety certifications or quality indicators visible
6. **Natural SEO keywords**: Work in relevant terms parents search (e.g., "portable", "hypoallergenic", "lightweight")
7. **Clear & concise**: 3-4 short paragraphs, professional but warm tone
8. **Ends with CTA consideration**: Gently suggest when/why to buy

Tone: Warm, trustworthy, knowledgeable - like advice from a trusted friend

Format as plain text (no markdown, no asterisks for bold).`;

  const message = await claudeClient.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMimeType,
              data: imageBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ]
  });

  // Extract text from response
  const textContent = message.content.find(block => block.type === 'text');
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  return textContent.text;
}

/**
 * Generate product description using Gemini Vision
 * @param {string} productName - Product name
 * @param {string} imageBase64 - Base64 encoded image data (without data URI prefix)
 * @param {string} imageMimeType - MIME type of image (e.g., "image/jpeg")
 * @returns {Promise<string>} Generated description
 */
async function generateDescriptionWithGemini(productName, imageBase64, imageMimeType = 'image/jpeg') {
  if (!geminiClient) {
    throw new Error('Gemini API not configured. Set GEMINI_API_KEY environment variable.');
  }

  const model = geminiClient.getGenerativeModel({ model: 'gemini-pro-vision' });

  const prompt = `You are a product description writer for SnuggleUp, a South African e-commerce store specializing in baby products.

Generate a compelling, SEO-optimized product description for: "${productName}"

Based on the product image provided, create a description that:

1. **Captivates parents**: Start with a hook that speaks to parent concerns (safety, comfort, convenience, quality)
2. **Describes visible features**: Detail what you see in the image (materials, colors, design, construction)
3. **Highlights benefits**: Translate features into benefits (e.g., "soft cotton" → "gentle on sensitive baby skin")
4. **Includes age recommendations**: Add appropriate age ranges if visible
5. **Mentions safety/quality**: Any safety certifications or quality indicators visible
6. **Natural SEO keywords**: Work in relevant terms parents search (e.g., "portable", "hypoallergenic", "lightweight")
7. **Clear & concise**: 3-4 short paragraphs, professional but warm tone
8. **Ends with CTA consideration**: Gently suggest when/why to buy

Tone: Warm, trustworthy, knowledgeable - like advice from a trusted friend

Format as plain text (no markdown, no asterisks for bold).`;

  const result = await model.generateContent([
    {
      inlineData: {
        data: imageBase64,
        mimeType: imageMimeType
      }
    },
    prompt
  ]);

  const response = await result.response;
  const text = response.text();

  if (!text) {
    throw new Error('No text content in Gemini response');
  }

  return text;
}

/**
 * Generate product description using either Claude or Gemini
 * @param {string} provider - 'claude' or 'gemini'
 * @param {string} productName - Product name
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} imageMimeType - MIME type (default: 'image/jpeg')
 * @returns {Promise<string>} Generated description
 */
export async function generateProductDescription(provider, productName, imageBase64, imageMimeType = 'image/jpeg') {
  if (!productName || !productName.trim()) {
    throw new Error('Product name is required');
  }

  if (!imageBase64 || !imageBase64.trim()) {
    throw new Error('Image data is required');
  }

  const normalizedProvider = String(provider || '').toLowerCase().trim();

  if (normalizedProvider === 'claude') {
    console.log(`✨ Generating description with Claude (Quality) for: ${productName}`);
    return await generateDescriptionWithClaude(productName, imageBase64, imageMimeType);
  } else if (normalizedProvider === 'gemini') {
    console.log(`✨ Generating description with Gemini (Favorable) for: ${productName}`);
    return await generateDescriptionWithGemini(productName, imageBase64, imageMimeType);
  } else {
    throw new Error(`Invalid provider: ${provider}. Use 'claude' or 'gemini'.`);
  }
}

/**
 * Check which providers are configured
 * @returns {Object} { claude: boolean, gemini: boolean }
 */
export function getAvailableProviders() {
  return {
    claude: !!claudeClient,
    gemini: !!geminiClient
  };
}

export { claudeClient, geminiClient };
