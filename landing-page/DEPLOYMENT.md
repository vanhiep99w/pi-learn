# Deployment Guide

Complete guide to deploy your landing page to production.

## 🚦 Pre-Deployment Checklist

### Content ✍️

- [ ] **Branding updated** - Replace "ShopPro" with your brand name
- [ ] **Hero headline** - Compelling value proposition
- [ ] **Features updated** - Your 6 key features with descriptions
- [ ] **Pricing configured** - Correct prices and plan details
- [ ] **Testimonials** - Real customer quotes (not placeholders)
- [ ] **Footer links** - Privacy policy, terms, social media URLs
- [ ] **CTA buttons** - Clear call-to-action text

### Configuration ⚙️

- [ ] **Email backend** - Formspree ID or custom API configured
- [ ] **Google Analytics** - GA4 measurement ID added
- [ ] **Meta tags** - Title, description, OG tags updated
- [ ] **Favicon** - Custom favicon (replace emoji)
- [ ] **Logo** - Brand logo added to navigation
- [ ] **Contact email** - Update footer email address

### Assets 🎨

- [ ] **Hero image** - High-quality product/team photo (optional)
- [ ] **Testimonial avatars** - Real customer photos
- [ ] **All images optimized** - <500KB each, compressed
- [ ] **Alt text added** - All images have descriptive alt attributes
- [ ] **Icons** - Custom icons or Font Awesome (verify loading)

### Technical 🔧

- [ ] **Mobile tested** - iOS Safari, Android Chrome
- [ ] **Desktop tested** - Chrome, Firefox, Safari, Edge
- [ ] **Form validation** - Email form works correctly
- [ ] **Console errors** - No JavaScript errors (F12 console)
- [ ] **Links working** - All navigation and external links
- [ ] **Lighthouse audit** - Score >90 on all metrics
- [ ] **Accessibility** - Keyboard navigation, screen reader compatible
- [ ] **HTTPS** - SSL certificate configured
- [ ] **Performance** - Page load <3s on 3G

### SEO & Marketing 📈

- [ ] **robots.txt** - Created (see below)
- [ ] **sitemap.xml** - Created (see below)
- [ ] **Google Search Console** - Site verified
- [ ] **Social media cards** - OG tags tested (use [opengraph.xyz](https://opengraph.xyz/))
- [ ] **Schema markup** - Consider adding structured data
- [ ] **Analytics goals** - Conversion tracking setup

---

## 🌐 Deployment Options

### Option 1: Netlify (Recommended for beginners)

**Pros:** Free, automatic HTTPS, continuous deployment  
**Time:** 5 minutes

#### Steps:

1. **Create account** at [netlify.com](https://netlify.com/)

2. **Deploy via drag & drop:**
   - Click "Sites" → "Add new site" → "Deploy manually"
   - Drag `landing-page` folder to upload zone
   - Done! Get URL like `https://your-site.netlify.app`

3. **Custom domain (optional):**
   - Site settings → Domain management → Add custom domain
   - Update DNS records at your domain registrar
   - HTTPS automatically enabled

4. **Environment variables (for API keys):**
   - Site settings → Environment variables
   - Add `FORMSPREE_ID`, `GA_MEASUREMENT_ID`, etc.

#### Netlify Configuration File (optional)

Create `netlify.toml` in `landing-page/`:

```toml
[build]
  publish = "."
  
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

---

### Option 2: Vercel

**Pros:** Fast CDN, great DX, edge functions  
**Time:** 5 minutes

#### Steps:

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   cd landing-page
   vercel
   ```

3. **Follow prompts:**
   - Link to existing project? No
   - Project name: your-landing-page
   - Directory: ./ (current directory)

4. **Production deployment:**
   ```bash
   vercel --prod
   ```

#### Vercel Configuration (optional)

Create `vercel.json`:

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ]
}
```

---

### Option 3: GitHub Pages

**Pros:** Free, integrated with Git  
**Time:** 10 minutes

#### Steps:

1. **Create GitHub repository:**
   ```bash
   cd landing-page
   git init
   git add .
   git commit -m "Initial landing page"
   git branch -M main
   git remote add origin https://github.com/username/landing-page.git
   git push -u origin main
   ```

2. **Enable GitHub Pages:**
   - Repository → Settings → Pages
   - Source: Deploy from branch
   - Branch: main, folder: / (root)
   - Save

3. **Access site:**
   - URL: `https://username.github.io/landing-page/`
   - Takes 2-5 minutes to deploy

4. **Custom domain (optional):**
   - Settings → Pages → Custom domain
   - Add CNAME record at your DNS provider:
     ```
     CNAME  www  username.github.io
     ```

---

### Option 4: Cloudflare Pages

**Pros:** Fast global CDN, DDoS protection  
**Time:** 10 minutes

#### Steps:

1. **Sign up** at [pages.cloudflare.com](https://pages.cloudflare.com/)

2. **Connect Git repository:**
   - Create new project
   - Connect GitHub/GitLab account
   - Select repository

3. **Build settings:**
   - Build command: (leave empty)
   - Build output directory: ./
   - Deploy

4. **Custom domain:**
   - Project settings → Custom domains
   - Add domain (Cloudflare handles DNS)

---

### Option 5: Traditional Web Hosting

**Pros:** Full control, works with any host  
**Time:** Varies

#### Via FTP:

1. **Get FTP credentials** from your hosting provider

2. **Upload files** using FileZilla or similar:
   ```
   Remote directory: /public_html/
   Local directory: /landing-page/
   
   Upload:
   - index.html
   - css/
   - js/
   - assets/
   ```

3. **Access site:** `https://yourdomain.com/`

#### Via SSH/Terminal:

```bash
# Connect to server
ssh user@yourserver.com

# Navigate to web directory
cd /var/www/html

# Upload files (from local machine)
scp -r landing-page/* user@yourserver.com:/var/www/html/
```

---

## 🔒 Security Hardening

### 1. Create robots.txt

Create `landing-page/robots.txt`:

```txt
User-agent: *
Allow: /

Sitemap: https://yourdomain.com/sitemap.xml
```

### 2. Create sitemap.xml

Create `landing-page/sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://yourdomain.com/</loc>
    <lastmod>2026-03-22</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

### 3. Security Headers (Netlify/Vercel)

Add to `_headers` file:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### 4. Content Security Policy (Advanced)

Add to HTML `<head>`:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; 
               style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; 
               font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com;
               img-src 'self' data: https://i.pravatar.cc https://images.unsplash.com;">
```

---

## 📊 Post-Deployment

### 1. Verify Deployment

- [ ] Site loads without errors
- [ ] All images display correctly
- [ ] Email form submits successfully
- [ ] Navigation links work
- [ ] Mobile responsive working
- [ ] HTTPS enabled (green padlock)

### 2. Setup Monitoring

**Google Search Console:**
1. Visit [search.google.com/search-console](https://search.google.com/search-console)
2. Add property → URL prefix
3. Verify ownership (HTML file or meta tag)
4. Submit sitemap.xml

**Google Analytics:**
1. Verify tracking working:
   ```
   Visit site → Check Real-time reports in GA4
   ```

**Uptime Monitoring:**
- [UptimeRobot](https://uptimerobot.com/) - Free monitoring
- [Pingdom](https://pingdom.com/) - Detailed reports

### 3. Performance Optimization

**Enable Caching:**

For Netlify (`netlify.toml`):
```toml
[[headers]]
  for = "*.css"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "*.js"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

**Compress Assets:**

```bash
# Install tools
npm install -g imagemin-cli svgo

# Compress images
imagemin assets/*.jpg --out-dir=assets/compressed

# Optimize SVGs
svgo assets/icons/*.svg
```

**Minify CSS/JS (optional):**

```bash
# Install
npm install -g clean-css-cli uglify-js

# Minify CSS
cleancss -o css/styles.min.css css/styles.css

# Minify JS
uglifyjs js/main.js -o js/main.min.js -c -m
```

Then update `index.html`:
```html
<link rel="stylesheet" href="css/styles.min.css">
<script src="js/main.min.js"></script>
```

---

## 🎯 Marketing Launch

### 1. Social Media

Share on:
- [ ] LinkedIn (company + personal)
- [ ] Twitter/X
- [ ] Facebook business page
- [ ] Instagram story/post
- [ ] Product Hunt (if SaaS product)

### 2. Email Campaign

- [ ] Email existing customers
- [ ] Newsletter announcement
- [ ] Personal outreach to warm leads

### 3. Paid Advertising

- [ ] Google Ads (search + display)
- [ ] Facebook/Instagram ads
- [ ] LinkedIn sponsored content
- [ ] Retargeting campaigns

### 4. SEO

- [ ] Submit to Google Search Console
- [ ] Submit to Bing Webmaster Tools
- [ ] Create backlinks (guest posts, directories)
- [ ] Optimize for target keywords

---

## 📈 Track Success

### Key Metrics to Monitor:

| Metric | Tool | Target |
|--------|------|--------|
| **Page views** | Google Analytics | Track growth |
| **Bounce rate** | Google Analytics | <50% |
| **Avg. session** | Google Analytics | >2 minutes |
| **Form submissions** | Formspree/localStorage | Track conversions |
| **Conversion rate** | GA4 Goals | >2% |
| **Page load speed** | Lighthouse | <3 seconds |
| **Mobile traffic** | Google Analytics | Monitor % |

### Setup Conversion Tracking:

**Google Analytics 4:**
1. Admin → Events → Create event
2. Event name: `email_signup`
3. Mark as conversion

Already implemented in `main.js`:
```javascript
trackEvent('email_signup', { email: email });
```

---

## 🐛 Common Issues

### Issue: Form not submitting in production

**Solution:**
1. Check Formspree ID is correct (not `YOUR_FORM_ID`)
2. Check browser console for CORS errors
3. Test with browser network tab (F12 → Network)

### Issue: Images not loading

**Solution:**
1. Check all image paths are relative (not absolute)
2. Verify images uploaded to hosting
3. Check console for 404 errors

### Issue: Lighthouse score low

**Solution:**
1. Compress images (<500KB each)
2. Minify CSS/JS
3. Enable caching headers
4. Remove unused CSS/JS

### Issue: Mobile layout broken

**Solution:**
1. Test with browser DevTools (F12 → responsive mode)
2. Check viewport meta tag exists
3. Verify CSS media queries working

---

## 📞 Support Resources

- **Netlify Docs:** https://docs.netlify.com/
- **Vercel Docs:** https://vercel.com/docs
- **GitHub Pages:** https://docs.github.com/en/pages
- **Formspree Help:** https://help.formspree.io/
- **Google Analytics:** https://support.google.com/analytics

---

**Last updated:** 2026-03-22  
**Version:** 1.0.0
