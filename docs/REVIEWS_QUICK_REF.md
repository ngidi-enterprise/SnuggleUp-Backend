# CJ Product Reviews - Quick Reference

## Live Endpoint
- **URL**: `GET /api/cj/products/:pid/reviews`
- **Backend**: `backend/src/routes/cj.js` (lines 46-55)
- **Service**: `backend/src/services/cjClient.js` → `getProductReviews()` method
- **Frontend**: `frontend/src/components/ProductReviews.jsx` + `ProductReviews.css`

## CJ Official API
```
Endpoint: https://developers.cjdropshipping.com/api2.0/v1/product/productComments
Method:   GET
Params:   pid (required), pageNum, pageSize, score
Headers:  CJ-Access-Token: {token}

Response fields:
- commentId: unique review ID
- score: rating 1-5
- comment: review text
- commentDate: ISO datetime
- commentUser: masked username
- commentUrls: image URLs array
- countryCode: buyer country
- flagIconUrl: country flag icon URL
```

## Frontend Flow
1. User opens product detail modal
2. `CJProductDetail.jsx` renders `<ProductReviews productId={cj_pid} />`
3. `ProductReviews.jsx` useEffect calls `getProductReviews(productId)`
4. `cjApi.js` → backend `/api/cj/products/:pid/reviews`
5. Backend fetches from CJ API + normalizes
6. Reviews display with avg rating, distribution, individual cards
7. Responsive CSS adapts to mobile (≤768px, ≤480px)

## Backend Normalization
```javascript
CJ Response → Internal Schema:
{
  commentId → id
  score → rating
  comment → comment
  commentUser → author
  commentDate → date
  commentUrls → images
  countryCode → countryCode
}
```

## Mobile Breakpoints (ProductReviews.css)
- **1024px+**: Full desktop layout
- **768px-1023px**: Tablet (adjusted spacing)
- **≤480px**: Mobile (compact, touch-friendly)

## Environment Requirements
- `CJ_ACCESS_TOKEN`: Set in backend env (required for API calls)
- No database changes (reviews fetched live from CJ)
- Stateless implementation (no caching required)

## Testing Checklist
- [ ] Backend: Test `/api/cj/products/2511190404421609900/reviews` with curl
- [ ] Frontend: Open product modal, verify reviews load
- [ ] Mobile: Test on phone/tablet, check responsive layout
- [ ] Performance: Monitor CJ API rate limits (1 req/sec)
- [ ] Error handling: Test with invalid PID, network error

## Known Limitations
- CJ API doesn't include "helpful count" in product comments (set to 0)
- CJ doesn't indicate verified purchases in product comments (set to false)
- Usernames are masked by CJ (e.g., "F***o")
- Max ~280+ reviews per product typical on CJ

## Deprecated API
- ❌ `/product/comments` (deprecated June 1, 2024) — NOT USED
- ✅ `/product/productComments` (current) — IMPLEMENTED

---
**Status**: Ready for deployment. All files pass linting/compilation.
