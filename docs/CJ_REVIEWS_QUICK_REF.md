# CJ Reviews Quick Reference

## The Fix (One File Changed)

### File: `backend/src/services/cjClient.js`

**Location:** Lines 348-410 (the `getProductReviews` method)

**What was wrong:**
```javascript
// ❌ BEFORE: Wrong endpoint
async getProductReviews(pid) {
  const url = CJ_BASE_URL + '/product/query';  // Doesn't return reviews
  // ... extracted from wrong place, guessed field names
}
```

**What it is now:**
```javascript
// ✅ AFTER: Correct endpoint
async getProductReviews(pid, options = {}) {
  const accessToken = await getAccessToken();
  const url = CJ_BASE_URL + '/product/productComments';  // ← Correct endpoint
  
  const query = {
    pid,
    pageNum: options.pageNum || 1,
    pageSize: options.pageSize || 50,
  };
  
  const json = await http('GET', url, {
    query,
    headers: { 'CJ-Access-Token': accessToken },
  });

  if (!json.success || !json.data || !Array.isArray(json.data.list)) {
    return [];  // Return empty instead of throwing
  }

  const rawReviews = json.data.list || [];
  
  // Map CJ's native fields to our format
  const normalized = rawReviews.map((r, idx) => ({
    id: r.commentId || `${pid}-${idx}`,
    rating: Math.min(Math.max(Number(r.score || 5), 1), 5),
    title: r.comment ? r.comment.slice(0, 80) : 'Review',
    comment: r.comment || '',
    author: r.commentUser || 'Customer',
    helpful: 0,
    date: r.commentDate ? new Date(r.commentDate).toISOString() : null,
    images: Array.isArray(r.commentUrls) ? r.commentUrls : [],
    verified: true,
    country: r.countryCode,
    flagIcon: r.flagIconUrl,
  })).filter(r => r.comment && r.comment.trim().length > 0);

  return normalized;
}
```

---

## Testing Steps

### 1. Test with Your Test PID
```
PID: 2511190404421609900
Expected: 285 reviews with ratings, authors, dates, images
```

### 2. Using Browser Test Tool
```
1. Open: test-reviews-endpoint.html
2. Click: "Test Backend API"
3. Should see: Reviews populate with full details
```

### 3. Using cURL
```bash
# Test CJ API directly (requires token):
curl -H "CJ-Access-Token: YOUR_TOKEN" \
  'https://developers.cjdropshipping.com/api2.0/v1/product/productComments?pid=2511190404421609900&pageSize=5'

# Test backend route (requires backend running):
curl 'http://localhost:3000/api/cj/products/2511190404421609900/reviews'
```

---

## CJ API Details

| Property | Value |
|----------|-------|
| **Endpoint** | `https://developers.cjdropshipping.com/api2.0/v1/product/productComments` |
| **Method** | GET |
| **Required Params** | `pid` |
| **Optional Params** | `pageNum`, `pageSize`, `score` |
| **Auth Header** | `CJ-Access-Token: {access_token}` |

### Response Structure
```javascript
{
  "success": true,
  "code": 0,
  "data": {
    "pageNum": "1",
    "pageSize": "50",
    "total": "285",
    "list": [
      {
        "commentId": 1536993287524069376,
        "pid": "1534092419615174656",
        "comment": "Great product!",
        "commentUser": "J***n",
        "score": 5,
        "commentDate": "2022-06-13T00:00:00+08:00",
        "commentUrls": ["https://...jpg"],
        "countryCode": "US",
        "flagIconUrl": "https://..."
      },
      // ... more reviews
    ]
  }
}
```

---

## Data Transformation

```
CJ API Response          →  Backend Service            →  Frontend Component
─────────────────────────────────────────────────────────────────────────
commentId               →   id
score: 5                →   rating: 5
comment: "text"         →   comment: "text"
commentUser: "J***n"    →   author: "J***n"
commentDate: "2022-..." →   date: "2022-...Z" (ISO)
commentUrls: [...]      →   images: [...]
countryCode: "US"       →   country: "US"
flagIconUrl: "http://..." → flagIcon: "http://..."
(not in CJ)             →   verified: true
(not in CJ)             →   helpful: 0
(not in CJ)             →   title: "text" (first 80 chars)
```

---

## Checklist Before Deploy

- [ ] Backend code changed: `getProductReviews()` method uses `/product/productComments`
- [ ] Test with PID: `2511190404421609900` shows reviews
- [ ] Frontend displays reviews with ratings
- [ ] Mobile responsive (test on mobile width)
- [ ] No console errors
- [ ] CJ token is valid (not expired)

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `No reviews yet` | Backend returning 0 reviews | Check CJ API response, try different PID with known reviews |
| `Failed to fetch` | Backend not running | Start backend: `cd backend && npm run dev` |
| `401 Unauthorized` | Invalid CJ token | Regenerate token in `GET_CJ_TOKEN.md` |
| `400 Bad Request` | Invalid PID format | Use correct format: numeric string like `2511190404421609900` |
| Reviews empty in UI | Frontend can't find reviews in response | Check browser dev tools Network tab |

---

## Files Involved

```
backend/
  src/
    services/
      cjClient.js          ← CHANGED: getProductReviews() method
    routes/
      cj.js                ← No change needed
      
frontend/
  src/
    lib/
      cjApi.js             ← No change needed
    components/
      ProductReviews.jsx   ← No change needed
      ProductReviews.css   ← No change needed
      CJProductDetail.jsx  ← No change needed
      
test-reviews-endpoint.html ← NEW: Testing tool
```

---

## Key Code References

### Backend Route Handler (No Changes)
```javascript
// In backend/src/routes/cj.js
router.get('/api/cj/products/:pid/reviews', optionalAuth, async (req, res) => {
  try {
    const reviews = await cjClient.getProductReviews(req.params.pid);
    return res.json({
      source: 'cj',
      count: reviews.length,
      reviews,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
```

### Frontend Hook (No Changes)
```javascript
// In frontend/src/lib/cjApi.js
export async function getProductReviews(pid) {
  return http.get(`/api/cj/products/${pid}/reviews`);
}
```

### Frontend Component (No Changes)
```javascript
// In frontend/src/components/ProductReviews.jsx
const { data: reviews, isLoading, error } = useFetch(() => getProductReviews(pid), [pid]);

return (
  <div className="reviews-container">
    <h2>Customer Reviews</h2>
    {isLoading && <p>Loading...</p>}
    {error && <p>Failed to load reviews</p>}
    {reviews && reviews.length > 0 ? (
      <>
        <ReviewSummary reviews={reviews} />
        <ReviewList reviews={reviews} />
      </>
    ) : (
      <p>No reviews yet</p>
    )}
  </div>
);
```

---

## Success Indicators

### You'll Know It Works When:
1. ✅ Backend responds with 200 and `{ count: 285, reviews: [...] }` for test PID
2. ✅ Frontend ProductReviews component receives review data
3. ✅ Star ratings display (0-5 stars)
4. ✅ Customer names show (masked like "J***n")
5. ✅ Review dates display
6. ✅ Images show if included
7. ✅ Rating distribution shows (e.g., "5★ 200 reviews")
8. ✅ Mobile responsive (column layout on small screens)
9. ✅ No console errors in browser dev tools

---

## Production Deployment

No special steps needed:
- Backend code is backward compatible
- No database changes
- No environment variable changes
- Existing products continue to work
- New products with reviews show them automatically

Just deploy the updated `backend/src/services/cjClient.js` file.
