import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

let openaiClient = null;

// Initialize OpenAI client only if API key is available
if (OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
}

/**
 * Generate SEO-optimized product titles for baby/kids products using AI
 * @param {string} originalTitle - The original CJ product title
 * @param {string} category - Product category
 * @param {number} price - Product price in ZAR
 * @returns {Promise<{suggestions: string[], reasoning: string}>}
 */
export async function generateSEOTitles(originalTitle, category = '', price = 0) {
  if (!openaiClient) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in environment variables.');
  }

  const prompt = `You are an expert e-commerce SEO specialist for a South African baby products store called "SnuggleUp".

Original product title: "${originalTitle}"
Category: ${category || 'Baby/Kids'}
Price: R ${price.toFixed(2)} ZAR

Generate 3 SEO-optimized product titles that will:
1. Increase conversion rates for South African parents shopping online
2. Include relevant keywords parents search for (e.g., "baby", "kids", specific age ranges, features)
3. Be compelling and clear (not clickbait)
4. Stay under 70 characters for optimal Google Shopping display
5. Include emotional/benefit words when appropriate (e.g., "soft", "safe", "comfortable", "premium")
6. Avoid generic words like "high quality" - be specific about features

Keep the core product identity but optimize for:
- Search engine visibility (Google Shopping, organic search)
- Parent concerns (safety, comfort, age-appropriate)
- South African market (use "Mum/Mom", "Baby" conventions)
- Mobile readability

Format your response as JSON:
{
  "suggestions": ["title1", "title2", "title3"],
  "reasoning": "Brief explanation of why these titles will perform better"
}

Be concise, specific, and parent-focused. Think about what a tired mom searching at midnight would type into Google.`;

  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective
      messages: [
        {
          role: 'system',
          content: 'You are an expert e-commerce SEO specialist focused on baby products for the South African market. Respond only with valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7, // Balanced creativity and consistency
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    // Validate response structure
    if (!result.suggestions || !Array.isArray(result.suggestions) || result.suggestions.length === 0) {
      throw new Error('Invalid response from AI: missing suggestions array');
    }

    // Filter out any titles over 70 characters
    const validSuggestions = result.suggestions
      .filter(title => title && title.length <= 70)
      .slice(0, 3);

    if (validSuggestions.length === 0) {
      throw new Error('AI generated titles were too long. Using original title.');
    }

    return {
      suggestions: validSuggestions,
      reasoning: result.reasoning || 'SEO-optimized titles for better discoverability'
    };

  } catch (error) {
    console.error('SEO title generation error:', error);
    
    // Fallback: simple rule-based optimization
    const fallbackTitle = optimizeTitleFallback(originalTitle);
    return {
      suggestions: [fallbackTitle, originalTitle],
      reasoning: 'AI unavailable - using basic optimization'
    };
  }
}

/**
 * Fallback title optimization using simple rules
 */
function optimizeTitleFallback(title) {
  let optimized = title;
  
  // Capitalize first letter of each word
  optimized = optimized.replace(/\b\w/g, char => char.toUpperCase());
  
  // Add "Baby" prefix if not present and title seems baby-related
  if (!/baby|infant|toddler|kids/i.test(optimized)) {
    optimized = 'Baby ' + optimized;
  }
  
  // Trim to 70 characters
  if (optimized.length > 70) {
    optimized = optimized.substring(0, 67) + '...';
  }
  
  return optimized;
}

export default { generateSEOTitles };
