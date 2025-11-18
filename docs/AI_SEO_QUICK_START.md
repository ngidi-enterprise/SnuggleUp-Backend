# Quick Start: AI SEO Title Generator

## 🚀 How to Use (Visual Guide)

### Step 1: Search for Products
```
Admin Dashboard → Product Curator → "Search Supplier Products" tab
[Search Box: "baby jumpsuit"] → [Search Button]
```

### Step 2: Click Add to Store
```
Product Card
┌─────────────────────────────────────┐
│ [Product Image]                     │
│ Clothes For Babies Baby Jumpsuits  │
│ Winter Fleece-lined                 │
│ Cost: R 13.91 | Retail: R 27.82    │
│ ┌─────────────────────────────────┐ │
│ │   [+ Add to Store]  ← Click!   │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Step 3: AI SEO Panel Opens
```
🤖 AI SEO Title Optimizer
┌──────────────────────────────────────────┐
│ [Product Image]                          │
│ Original CJ Title:                       │
│ Clothes For Babies Baby Jumpsuits       │
│ Winter Fleece-lined                      │
│                                          │
│ Category: Baby & Mother | Price: R 27.82│
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ ✨ Generate SEO Titles with AI    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Or: [Skip AI - Use Original Title]     │
└──────────────────────────────────────────┘
```

### Step 4: AI Generates 3 Titles
```
💡 SEO-optimized titles for better discoverability

Select an optimized title or edit below:

┌────────────────────────────────────────┐
│ ① Baby Winter Fleece Jumpsuit - Soft  │
│    Warm Clothing                        │
│    43 characters (Recommended)          │
│                            [Select] ←   │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ ② Fleece-Lined Baby Jumpsuit for      │
│    Winter - Cozy & Safe                 │
│    46 characters                        │
│                            [Select]     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ ③ Premium Baby Winter Jumpsuit -      │
│    Fleece Lined Warmth                  │
│    44 characters                        │
│                            [Select]     │
└────────────────────────────────────────┘

💾 Note: Original CJ title will be preserved
```

### Step 5: Click to Select → Product Added!
```
✓ Product Added Successfully!

Database Record:
{
  product_name: "Baby Winter Fleece Jumpsuit - Soft Warm Clothing",
  original_cj_title: "Clothes For Babies Baby Jumpsuits Winter Fleece-lined",
  seo_title: "Baby Winter Fleece Jumpsuit - Soft Warm Clothing",
  cj_cost_price: 13.91,
  custom_price: 27.82,
  ...
}
```

## 🎯 What Happens Behind the Scenes

```
┌─────────────────────────────────────────────────────────────┐
│                    USER CLICKS "ADD TO STORE"                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Show AI SEO Panel (Modal)   │
         │   - Display product info      │
         │   - Show "Generate" button    │
         └───────────────┬───────────────┘
                         │
           User clicks "Generate"
                         │
                         ▼
         ┌───────────────────────────────┐
         │  POST /api/admin/products/    │
         │  generate-seo-title           │
         │                               │
         │  Body:                        │
         │  {                            │
         │    originalTitle: "...",      │
         │    category: "...",           │
         │    price: 27.82               │
         │  }                            │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │    OpenAI GPT-4o-mini         │
         │    (seoTitleGenerator.js)     │
         │                               │
         │  Analyzes:                    │
         │  - Target audience (SA moms)  │
         │  - Keywords (baby, safe, etc) │
         │  - Character limits (70 max)  │
         │  - Emotional triggers         │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Returns 3 Suggestions       │
         │   + SEO Reasoning             │
         │                               │
         │  Response:                    │
         │  {                            │
         │    suggestions: [...],        │
         │    reasoning: "..."           │
         │  }                            │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Display Suggestions to User │
         │   - 3 clickable options       │
         │   - Original title preserved  │
         └───────────────┬───────────────┘
                         │
          User selects title
                         │
                         ▼
         ┌───────────────────────────────┐
         │  POST /api/admin/products     │
         │                               │
         │  Body:                        │
         │  {                            │
         │    cj_pid: "251016...",       │
         │    product_name: "Selected",  │
         │    original_cj_title: "...",  │
         │    seo_title: "Selected",     │
         │    ...                        │
         │  }                            │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   PostgreSQL Database         │
         │   curated_products table      │
         │                               │
         │  INSERT:                      │
         │  - product_name (display)     │
         │  - original_cj_title (ref)    │
         │  - seo_title (optimized)      │
         │  - All other fields           │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │     Product Now Live!         │
         │  - Shows in Curated tab       │
         │  - Customers see SEO title    │
         │  - Original kept for you      │
         └───────────────────────────────┘
```

## 💡 Pro Tips

### When AI Suggests Same Title as Original
✅ **That's good!** It means CJ's title was already optimized
→ Just use it, no changes needed

### If AI Takes Too Long (>10 seconds)
⚠️ **Possible rate limit**
→ Wait 60 seconds and try again
→ Or skip AI and use original title

### Editing Titles Manually
💬 You can always edit in the product edit modal later:
1. Go to "Curated Products" tab
2. Click "Edit" on product
3. Change `product_name` field
4. Save changes

### Testing Which Titles Work Best
📊 Future feature: Track which AI titles lead to more:
- Page views
- Add-to-cart clicks
- Actual purchases

## ⚙️ Environment Setup

### Required on Render
```bash
# Backend Service → Environment Variables
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
```

### Optional (for cost control)
```bash
# OpenAI Dashboard → Billing
Monthly Budget: $10
Alerts: 50%, 100%
```

## 🔍 Debugging

### Check if AI is working:
```bash
# Render Dashboard → snuggleup-backend → Logs
# Look for:
✅ "🤖 Generating SEO titles for: [product name]"
✅ "✨ AI returned 3 suggestions"
❌ "OpenAI API key not configured"
```

### Test API endpoint directly:
```bash
curl -X POST https://snuggleup-backend.onrender.com/api/admin/products/generate-seo-title \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "originalTitle": "Baby Clothes Winter Warm",
    "category": "Baby Clothing",
    "price": 25.00
  }'
```

---

## 📞 Support

**Issue**: AI not generating titles
**Fix**: Check OPENAI_API_KEY is set in Render environment

**Issue**: "Rate limit exceeded"
**Fix**: Wait 60 seconds, try again (OpenAI has 60 req/min limit)

**Issue**: All 3 suggestions identical
**Fix**: Original title is already perfect, use it!

**Issue**: Want to change prompt/style
**Fix**: Edit `backend/src/services/seoTitleGenerator.js` → `prompt` variable
