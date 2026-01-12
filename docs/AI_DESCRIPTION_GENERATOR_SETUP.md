# AI Description Generator Setup

## Overview
The AI description generator feature allows admins to automatically generate product descriptions based on product images and titles. It supports two AI providers:

- **Claude (Quality)** - Premium quality descriptions, best for complex/detailed products
- **Gemini (Favorable)** - Cost-effective, good for quick descriptions

## Installation

### Step 1: Install Dependencies

**Backend:**
```bash
cd backend
npm install @anthropic-ai/sdk @google/generative-ai
```

### Step 2: Get API Keys

#### Option A: Claude API Key
1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Create account / sign in
3. Navigate to **API Keys**
4. Create new key
5. Copy the key

#### Option B: Gemini API Key
1. Go to [https://ai.google.dev](https://ai.google.dev)
2. Click **Get API Key**
3. Create new project or select existing
4. Create new API key
5. Copy the key

### Step 3: Add to `.env` (Backend)

```env
# AI Description Generation
CLAUDE_API_KEY=sk-ant-v0-xxxxxxxxxxxxx          # For Quality descriptions
GEMINI_API_KEY=AIzaSyDxxxxxxxxxxxxx             # For Favorable descriptions

# Note: You can set both, one, or neither
# If neither is set, the "Generate" button will be disabled with a message
```

### Step 4: Restart Backend

```bash
npm run dev
```

## How It Works

### For Local Products (LocalProductManager)
1. Upload product image
2. Enter product name
3. Click **✨ Generate** button next to Description field
4. Choose provider from dropdown:
   - **💎 Quality (Claude)** - Better descriptions, ~$0.003 per image
   - **⚡ Favorable (Gemini)** - Cost-effective, ~$0.001 per image
5. AI analyzes image + product name → generates description
6. Description auto-fills in textarea

### For CJ Products (ProductCuration)
1. Open product editor
2. Click **✨ Generate** next to "Product Description (SEO-friendly)"
3. Same workflow as above
4. Description replaces current text

## API Endpoints

### Generate Description
```
POST /api/admin/products/generate-description
```

**Request:**
```json
{
  "provider": "claude",  // or "gemini"
  "productName": "Baby Cotton Romper",
  "imageBase64": "iVBORw0KGgoAAAANS...",
  "imageMimeType": "image/jpeg"
}
```

**Response:**
```json
{
  "description": "Soft, breathable cotton baby romper perfect for newborns..."
}
```

### Check Available Providers
```
GET /api/admin/products/description-providers
```

**Response:**
```json
{
  "claude": true,
  "gemini": true
}
```

## Image Processing

The frontend automatically:
1. Takes image from URL (local products) or data URI (uploaded)
2. Converts to base64
3. Detects MIME type (jpeg, png, webp, etc.)
4. Sends to backend for AI processing

Supported formats: JPEG, PNG, WebP, GIF

## Cost Comparison

| Provider | Cost/Image | Quality | Speed |
|----------|-----------|---------|-------|
| Claude   | $0.003    | ⭐⭐⭐⭐⭐ | ~5s   |
| Gemini   | $0.001    | ⭐⭐⭐⭐  | ~3s   |

## Prompt Engineering

The system uses optimized prompts that instruct AI to:
- Write for South African parents
- Include age recommendations
- Highlight safety features
- Use natural keywords
- 3-4 paragraph format
- Warm, trusted tone

## Error Handling

- **"No providers configured"** → Set CLAUDE_API_KEY or GEMINI_API_KEY in .env
- **"Upload product image first"** → Image is required for vision analysis
- **"Failed to generate description"** → API key invalid or image too large (>5MB)
- **"Enter product name first"** → Title is required for context

## Rate Limiting

- Claude: 600 requests/minute (typically enough)
- Gemini: 60 requests/minute free tier (upgrade for higher limits)

Add queuing if you expect high volume.

## Testing

```javascript
// Test Claude
const response = await fetch('http://localhost:3000/api/admin/products/generate-description', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    provider: 'claude',
    productName: 'Baby Diaper Pack',
    imageBase64: 'iVBORw0KGgoAAAANS...',
    imageMimeType: 'image/jpeg'
  })
});

const data = await response.json();
console.log(data.description);
```

## Troubleshooting

### Button doesn't appear
- ✅ Image must be uploaded
- ✅ At least one provider must be configured

### Dropdown is empty
- Check .env file has CLAUDE_API_KEY or GEMINI_API_KEY
- Restart backend after adding keys

### "Failed to generate description"
- Image might be corrupted or too large
- API key might be invalid
- Check backend logs: `npm run dev`

### Slow responses
- Claude is slower (5s+) but better quality
- Gemini is faster (3s) but slightly lower quality
- Network latency can affect timing

## What Gets Generated

**Typical Output Structure:**
```
[Opening hook about parent benefits]

[Feature description from image - what you see]

[Safety/quality features and age recommendations]

[Subtle CTA - when to buy]
```

**Example:**
```
Give your newborn the ultimate comfort with this premium cotton baby romper. 
Crafted from 100% organic cotton visible in the soft weave, this romper 
features snap buttons for easy diaper changes and gentle construction that 
won't irritate sensitive skin.

Perfect for babies from birth to 12 months, this versatile romper transitions 
beautifully from nursery to outings. The breathable fabric keeps your little 
one cool in summer and can be layered in winter.

Free from harsh dyes and certified safe for newborns, this romper gives you 
peace of mind while your baby gets the comfort they deserve.
```

---

**Questions?** Check backend logs or contact support.
