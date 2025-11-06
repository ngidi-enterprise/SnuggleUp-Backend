# Google Analytics 4 Setup Guide

This guide shows how to set up Google Analytics 4 (GA4) for SnuggleUp to track traffic, user behavior, conversions, and more.

## 1. Create Google Analytics 4 Property

1. Go to [Google Analytics](https://analytics.google.com/)
2. Click **Admin** (gear icon in bottom left)
3. Click **+ Create Property**
4. Enter property details:
   - **Property name**: SnuggleUp
   - **Reporting time zone**: (GMT+02:00) Johannesburg
   - **Currency**: South African Rand (R)
5. Click **Next**
6. Fill in business details and click **Create**
7. Accept Terms of Service

## 2. Get Your Measurement ID

1. In your new GA4 property, go to **Admin** → **Data Streams**
2. Click **Add stream** → **Web**
3. Enter:
   - **Website URL**: `https://snuggleup.co.za` (or your actual domain)
   - **Stream name**: SnuggleUp Website
4. Click **Create stream**
5. Copy your **Measurement ID** (format: `G-XXXXXXXXXX`)

## 3. Add Measurement ID to Your Site

Open `frontend/index.html` and replace `G-XXXXXXXXXX` with your actual Measurement ID:

```html
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-YOUR-ACTUAL-ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-YOUR-ACTUAL-ID', {
    send_page_view: false // We manually track SPAs
  });
</script>
```

**Example:**
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ABC123XYZ', {
    send_page_view: false
  });
</script>
```

## 4. Deploy Changes

After updating the Measurement ID:

```powershell
cd frontend
npm run build
```

Deploy the updated `dist/` folder to your hosting (Render, Netlify, Vercel, etc.).

## 5. Verify Tracking is Working

### Real-Time Testing
1. Go to **Reports** → **Realtime** in Google Analytics
2. Open your website in a browser
3. You should see yourself as an active user within ~30 seconds
4. Navigate around, add products to cart, etc.
5. Check that events appear in the Realtime report

### Test Events to Look For
- ✅ `page_view` - Page navigation
- ✅ `view_item` - Product detail views
- ✅ `add_to_cart` - Add to cart clicks
- ✅ `remove_from_cart` - Remove from cart
- ✅ `begin_checkout` - Checkout button click
- ✅ `purchase` - Successful payment
- ✅ `login` - User login
- ✅ `sign_up` - New user registration
- ✅ `search` - Product search (if implemented)

## 6. What You'll See in Analytics

### Traffic Sources (where users come from)
- **Direct** - Typed URL or bookmarks
- **Organic Search** - Google, Bing search results
- **Social** - Facebook, Instagram, TikTok, etc.
- **Referral** - Links from other websites
- **Paid Search** - Google Ads, etc.

### Key Reports
1. **Realtime** - Live users on your site right now
2. **Acquisition** → **Traffic acquisition** - Where users come from
3. **Engagement** → **Pages and screens** - Most viewed pages
4. **Engagement** → **Events** - All tracked events (add_to_cart, purchase, etc.)
5. **Monetization** → **Ecommerce purchases** - Revenue, conversion rate, average order value

### Conversion Tracking
GA4 automatically tracks these as **conversions**:
- `purchase` - Completed orders (most important!)
- `begin_checkout` - Checkout funnel
- You can mark other events as conversions in **Admin** → **Events**

## 7. Enhanced Ecommerce Features

Our tracking includes:
- **Product impressions** - Products shown to users
- **Product clicks** - Products viewed in detail
- **Add/remove from cart** - Cart activity
- **Checkout funnel** - Begin checkout → Payment
- **Purchase** - Revenue, items, transaction ID

### Revenue Reports
Go to **Monetization** → **Ecommerce purchases** to see:
- Total revenue
- Transactions
- Average order value
- Items per transaction
- Purchase-to-detail rate

## 8. Custom Dimensions (Optional)

You can add custom dimensions to track more data:

1. Go to **Admin** → **Custom definitions**
2. Click **Create custom dimension**
3. Examples:
   - **User Role** - Customer vs Admin
   - **Product Category** - Clothing, Toys, Feeding, etc.
   - **Payment Method** - PayFast

Add to tracking calls:
```javascript
trackEvent('add_to_cart', {
  product_category: 'Baby Clothing',
  user_role: 'customer'
});
```

## 9. Google Search Console Integration

Link Search Console to see:
- Which Google search queries bring traffic
- Click-through rates from search results
- Impressions and rankings

1. Go to **Admin** → **Product links** → **Search Console links**
2. Click **Link** and follow the wizard

## 10. Troubleshooting

### No data showing up?
- Check Measurement ID is correct in `index.html`
- Look in browser console for errors (F12 → Console)
- Verify `window.gtag` exists: Open console and type `typeof window.gtag` (should say "function")
- Clear browser cache and reload
- Wait 24-48 hours for full reports (Realtime should work immediately)

### Events not tracking?
- Open browser console (F12) and look for:
  ```
  gtag('event', 'add_to_cart', {...})
  ```
- Check Network tab for requests to `google-analytics.com/g/collect`

### Development vs Production
- GA tracks on both dev and production by default
- To exclude dev traffic:
  - Use separate Measurement IDs for dev/prod, OR
  - In GA4, go to **Admin** → **Data Filters** → Exclude internal traffic by IP

## 11. Quick Reference: Tracked Events

| Event | When it fires | What it tracks |
|-------|---------------|----------------|
| `page_view` | Route changes | SPA navigation |
| `view_item` | Product detail opened | Product name, price, category |
| `add_to_cart` | Add to cart button | Product, quantity, value |
| `remove_from_cart` | Remove from cart | Product, quantity |
| `begin_checkout` | Proceed to checkout | Cart items, total value |
| `purchase` | Payment success | Transaction ID, items, revenue, shipping |
| `login` | User logs in | Login method (email, google) |
| `sign_up` | New user registers | Sign-up method |
| `search` | Product search | Search term |

## 12. Privacy & GDPR Compliance

If selling to EU customers, consider:
- Cookie consent banner (use a library like `react-cookie-consent`)
- Privacy policy mentioning Google Analytics
- Anonymize IP addresses (GA4 does this by default)
- Allow users to opt-out

Add to `gtag` config:
```javascript
gtag('config', 'G-YOUR-ID', {
  anonymize_ip: true,
  allow_google_signals: false // Disable personalized ads
});
```

## 13. Next Steps

Once tracking is live:
1. **Set conversion goals** - Mark `purchase` as your primary conversion
2. **Create custom reports** - Focus on your KPIs
3. **Set up alerts** - Get notified of traffic spikes or drops
4. **A/B testing** - Test different product descriptions, pricing
5. **Google Ads integration** - Track ad ROI

## Support

- [GA4 Help Center](https://support.google.com/analytics/answer/10089681)
- [GA4 Academy (free courses)](https://analytics.google.com/analytics/academy/)
- [Ecommerce tracking guide](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)

---

**Current Status:**
- ✅ GA4 script installed in `index.html`
- ✅ Tracking utilities created in `frontend/src/lib/analytics.js`
- ✅ Events integrated into App.jsx, CheckoutSuccess, Login, Register
- ⏳ **Action needed:** Replace `G-XXXXXXXXXX` with your actual Measurement ID
