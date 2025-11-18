# AI SEO Title Generator Setup Guide

## Overview
The AI SEO Title Generator uses OpenAI's GPT-4 to create optimized product titles that increase discoverability and sales. When adding products from CJ to your curated list, the system will:

1. Show the original CJ product title
2. Generate 3 SEO-optimized alternatives using AI
3. Let you select or edit the best title
4. **Always preserve the original CJ title** for reference

## Features

### ✨ What the AI Does
- **Keyword optimization**: Adds relevant search terms parents use (e.g., "baby", "soft", "safe")
- **Character limits**: Keeps titles under 70 characters for Google Shopping
- **South African market**: Optimizes for local search behavior
- **Emotional triggers**: Includes benefit words like "comfortable", "premium", "soft"
- **Mobile-friendly**: Short, scannable titles for mobile shoppers

### 📊 Data Preserved
- **original_cj_title**: The exact title from CJ's API (never shown to customers)
- **seo_title**: Your chosen optimized title (what customers see)
- **product_name**: Display name (same as seo_title)

## Setup Instructions

### Step 1: Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **Create new secret key**
5. Name it "SnuggleUp SEO Generator"
6. Copy the key (starts with `sk-proj-...`)

### Step 2: Add to Render Environment

1. Go to your Render dashboard
2. Select your **snuggleup-backend** service
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   ```
   Key: OPENAI_API_KEY
   Value: sk-proj-your-actual-key-here
   ```
6. Click **Save Changes**
7. Render will automatically redeploy

### Step 3: Install Dependencies (Local Development)

If running locally:
```bash
cd backend
npm install openai
```

### Step 4: Test the Feature

1. Go to Admin Dashboard → Product Curator
2. Search for a product (e.g., "baby jumpsuit")
3. Click **+ Add to Store** on any product
4. You'll see the AI SEO panel:
   - Click **✨ Generate SEO Titles with AI**
   - Wait 3-5 seconds for AI suggestions
   - Review the 3 optimized titles
   - Click on your preferred title to add product
5. The product will be added with:
   - Your chosen SEO title (visible to customers)
   - Original CJ title (stored for reference, never shown)

## Cost Information

### OpenAI Pricing (as of Nov 2024)
- Model used: **gpt-4o-mini** (cost-effective for this use case)
- Average cost: **~$0.001 per product title generation**
- 1,000 products = ~$1.00
- Monthly limit recommended: $10 (covers ~10,000 products)

### Set Spending Limits
1. Go to [OpenAI Billing](https://platform.openai.com/account/billing)
2. Set **Monthly budget** to $10
3. Enable **Email alerts** at 50% and 100%

## Fallback Behavior

If OpenAI is unavailable (API key missing, rate limit, etc.):
- System shows **original CJ title**
- You can still add products normally
- Simple rule-based optimization applies:
  - Capitalizes words
  - Adds "Baby" prefix if missing
  - Trims to 70 characters

## Usage Tips

### When to Use AI Titles
✅ **Always use for**:
- New products being added to store
- Products in competitive categories
- Items you want to rank higher in search

❌ **Skip AI for**:
- Products you're testing (not sure if they'll sell)
- Bulk imports (to save costs)

### Best Practices
1. **Review AI suggestions** - Don't blindly accept, check they make sense
2. **Test different titles** - Try variants for same product to see what sells
3. **Keep original** - Always preserved automatically for reference
4. **Monitor performance** - Track which AI titles lead to more sales

## Troubleshooting

### "AI service unavailable" Error
**Cause**: OpenAI API key not set or invalid
**Fix**: 
1. Check Render environment variable `OPENAI_API_KEY`
2. Verify key is valid on OpenAI dashboard
3. Redeploy backend after adding key

### "Rate limit exceeded" Error  
**Cause**: Too many requests to OpenAI (60/minute limit)
**Fix**:
1. Wait 60 seconds and try again
2. Add products more slowly
3. Consider upgrading OpenAI tier

### AI Returns Same Title
**Cause**: Original title is already well-optimized
**Fix**: Use original title, it's likely already good!

## Example Transformations

### Before (CJ Original)
```
Clothes For Babies Baby Jumpsuits Winter Fleece-lined
```

### After (AI Optimized)
```
1. Baby Winter Fleece Jumpsuit - Soft Warm Clothing (Recommended)
2. Fleece-Lined Baby Jumpsuit for Winter - Cozy & Safe
3. Premium Baby Winter Jumpsuit - Fleece Lined Warmth
```

### Why It's Better
- ✅ Shorter (under 70 chars)
- ✅ Includes keywords: "soft", "warm", "cozy", "safe"
- ✅ Mobile-friendly formatting
- ✅ Benefit-focused (warmth, safety)
- ✅ Clearer product identity

## Database Schema

```sql
-- Existing columns
product_name TEXT NOT NULL          -- Display name (same as seo_title)

-- New columns added automatically
original_cj_title TEXT             -- CJ's exact title (preserved)
seo_title TEXT                     -- AI-optimized or custom title
```

## Next Steps

After setup:
1. ✅ Add `OPENAI_API_KEY` to Render
2. ✅ Redeploy backend (automatic)
3. ✅ Test with one product
4. ✅ Review AI suggestions quality
5. ✅ Start curating products with optimized titles!

---

**Questions?** Check backend logs on Render for detailed error messages or AI responses.
