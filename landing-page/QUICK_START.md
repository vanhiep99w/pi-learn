# 🚀 Quick Start Guide

Get your landing page running in 2 minutes!

## Option 1: View Immediately (No Setup)

Just open the file:

```bash
# Double-click this file in your file browser:
landing-page/index.html
```

Or use a local server:

```bash
# Python 3
cd landing-page
python3 -m http.server 8000
# Open: http://localhost:8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js
npx serve
# Or: npm install -g http-server && http-server

# PHP
php -S localhost:8000
```

## Option 2: Test Everything

Open the test page:

```bash
# Open in browser:
landing-page/test.html
```

Then click "▶️ Run All Tests" to verify:
- ✅ LocalStorage working
- ✅ Email form functional
- ✅ Page view tracking
- ✅ Avatar images loading
- ✅ Analytics tracking

## Option 3: View Email Dashboard

```bash
# Open in browser:
landing-page/view-emails.html
```

Shows:
- 📊 Total emails collected
- 📈 Page views
- 💹 Conversion rate
- 📥 Export to CSV
- 📋 Copy emails

## 📝 Next Steps

### 1. Customize Content (5 minutes)

Edit `index.html`:

```html
<!-- Line ~80: Hero section -->
<h1>Your Headline Here</h1>
<p>Your value proposition...</p>

<!-- Line ~200-300: Features -->
Update 6 feature descriptions

<!-- Line ~350-400: Pricing -->
Update 3 pricing tiers

<!-- Line ~400-450: Testimonials -->
Replace with real customer quotes
```

### 2. Change Colors (2 minutes)

Edit `css/styles.css` (line 1-20):

```css
:root {
    --primary-color: #6366F1;    /* Your brand color */
    --secondary-color: #EC4899;  /* Accent color */
    --accent-color: #14B8A6;     /* Highlight color */
}
```

### 3. Setup Email Form (10 minutes)

**Option A: Formspree (Easiest)**

1. Sign up at [formspree.io](https://formspree.io/)
2. Create new form, get ID (e.g., `xpznabcd`)
3. Edit `js/main.js` line ~300:
   ```javascript
   const FORMSPREE_ID = 'xpznabcd'; // Your ID here
   ```

**Option B: Development Mode (No Setup)**

Emails automatically saved to browser localStorage!
- Submit form on landing page
- View at `view-emails.html`
- Export CSV or copy emails

### 4. Deploy (5 minutes)

**Netlify (Easiest):**
1. Go to [netlify.com](https://netlify.com/)
2. Drag & drop `landing-page` folder
3. Done! Get free HTTPS URL

**Alternatives:**
- Vercel: `vercel` (install CLI first)
- GitHub Pages: Push to GitHub repo
- Any hosting: Upload via FTP

## 🎨 Popular Customizations

### Change Logo

```html
<!-- index.html line ~40 -->
<div class="nav__logo">
    <img src="assets/logo.png" alt="Brand">
</div>
```

### Add Real Avatars

```html
<!-- index.html lines ~339, 362, 385 -->
<img src="assets/avatars/customer1.jpg" alt="Name">
```

### Enable Google Analytics

```html
<!-- index.html line ~31-48 -->
<!-- Uncomment and add your GA4 ID -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
```

## 📚 Full Documentation

- **README.md** - Complete customization guide
- **DEPLOYMENT.md** - Production deployment guide
- **CHANGELOG.md** - All changes made to template
- **assets/README.md** - Image guidelines

## 🧪 Testing Checklist

Before launch:

- [ ] Test email form (submit + check dashboard)
- [ ] View on mobile device
- [ ] Check all links work
- [ ] Replace placeholder content
- [ ] Update meta tags (title, description)
- [ ] Add real customer testimonials
- [ ] Update pricing information
- [ ] Test on Chrome, Firefox, Safari

## 🆘 Quick Help

### Email form not working?

**Check:**
1. Browser console (F12) - any errors?
2. Formspree ID configured? (`js/main.js` line ~300)
3. Try development mode (emails in localStorage)

### Images not loading?

**Check:**
1. Internet connection (using Pravatar online service)
2. Browser console for errors
3. Image paths correct?

### Need to clear test data?

```javascript
// In browser console (F12):
localStorage.clear()
```

Or use "🗑️ Clear All Data" button in `test.html`

## 📊 View Collected Data

```javascript
// In browser console (F12):

// View all emails
JSON.parse(localStorage.getItem('landing_page_emails'))

// View page views
localStorage.getItem('landing_page_views')

// Calculate conversion rate
const emails = JSON.parse(localStorage.getItem('landing_page_emails') || '[]').length;
const views = parseInt(localStorage.getItem('landing_page_views') || '0');
console.log('Conversion rate:', (emails / views * 100).toFixed(2) + '%');
```

## 🎯 Success!

You're ready! Your landing page is:

✅ Fully responsive  
✅ Email form working (localStorage or Formspree)  
✅ Analytics ready  
✅ SEO optimized  
✅ Production ready  

---

**Need more help?** Read the full **README.md** or **DEPLOYMENT.md**

**Ready to deploy?** See **DEPLOYMENT.md** for 5 platform options

**Good luck! 🚀**
