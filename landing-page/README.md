# Landing Page - ShopPro

A modern, responsive landing page for SaaS/e-commerce products built with pure HTML, CSS, and JavaScript.

## 🚀 Quick Start

1. **Open in browser:**
   ```bash
   # Using Python
   cd landing-page
   python3 -m http.server 8000
   # Then visit: http://localhost:8000
   
   # Or using Node.js
   npx serve
   ```

2. **Or open directly:**
   - Simply double-click `index.html` to view in browser

## 📁 Structure

```
landing-page/
├── index.html              # Main HTML file
├── css/
│   └── styles.css         # All styles (includes responsive design)
├── js/
│   └── main.js            # All JavaScript functionality
├── assets/                # Images and icons
│   ├── avatars/          # Testimonial photos (placeholder)
│   ├── icons/            # Feature icons (optional)
│   └── README.md         # Asset guidelines
└── README.md             # This file
```

## ✨ Features

- ✅ **Fully Responsive** - Mobile, tablet, desktop optimized
- ✅ **Smooth Animations** - CSS transitions + scroll effects
- ✅ **Email Form** - With validation + localStorage fallback
- ✅ **SEO Optimized** - Meta tags, structured data ready
- ✅ **Accessible** - WCAG 2.1 guidelines, keyboard navigation
- ✅ **Fast** - No framework dependencies, vanilla JS only
- ✅ **Easy Customization** - CSS variables for theming

## 🎨 Customization Guide

### 1. Change Colors (Easiest)

Edit `css/styles.css` (lines 1-50):

```css
:root {
    /* Main Colors - Change these! */
    --primary-color: #6366F1;      /* Indigo */
    --secondary-color: #EC4899;    /* Pink */
    --accent-color: #14B8A6;       /* Teal */
    
    /* Text Colors */
    --text-primary: #1F2937;       /* Dark gray */
    --text-secondary: #6B7280;     /* Medium gray */
    --text-muted: #9CA3AF;         /* Light gray */
}
```

**Popular Color Schemes:**

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|---------|
| **Tech Blue** | `#3B82F6` | `#1D4ED8` | `#60A5FA` |
| **Nature Green** | `#10B981` | `#059669` | `#34D399` |
| **Sunset Orange** | `#F59E0B` | `#D97706` | `#FBBF24` |
| **Modern Purple** | `#8B5CF6` | `#7C3AED` | `#A78BFA` |

### 2. Update Content

#### **a) Hero Section** (`index.html` lines ~70-135)

```html
<h1 class="hero__title">
    Your Headline Here<br>
    <span class="highlight">Key Benefit</span>
</h1>
<p class="hero__description">
    Your value proposition in 1-2 sentences.
</p>
```

#### **b) Features** (lines ~145-280)

Update 6 feature cards:
```html
<div class="feature__card">
    <div class="feature__icon">
        <i class="fas fa-your-icon"></i>
    </div>
    <h3 class="feature__title">Feature Name</h3>
    <p class="feature__description">Feature description...</p>
</div>
```

**Icon Resources:**
- [Font Awesome Gallery](https://fontawesome.com/icons) (already included)
- Or add custom SVG icons to `assets/icons/`

#### **c) Pricing** (lines ~285-355)

Update 3 pricing tiers:
```html
<div class="pricing__card">
    <h3 class="pricing__name">Plan Name</h3>
    <div class="pricing__price">
        <span class="price__currency">₫</span>
        <span class="price__amount">299,000</span>
        <span class="price__period">/tháng</span>
    </div>
    <ul class="pricing__features">
        <li><i class="fas fa-check"></i> Feature 1</li>
        <!-- Add more features -->
    </ul>
</div>
```

#### **d) Testimonials** (lines ~360-410)

Replace with real customer feedback:
```html
<div class="testimonial__card">
    <p class="testimonial__text">
        "Your customer quote here..."
    </p>
    <div class="testimonial__author">
        <div class="author__avatar">
            <img src="assets/avatars/customer1.jpg" alt="Name">
        </div>
        <div class="author__info">
            <p class="author__name">Customer Name</p>
            <p class="author__role">Title, Company</p>
        </div>
    </div>
</div>
```

### 3. Setup Email Form

#### **Option A: Using Formspree** (Recommended)

1. Create account at [formspree.io](https://formspree.io/)
2. Get your form ID (e.g., `xpznabcd`)
3. Edit `js/main.js` line ~295:
   ```javascript
   const FORMSPREE_ID = 'xpznabcd'; // Replace YOUR_FORM_ID
   ```

#### **Option B: Custom Backend API**

Edit `js/main.js` function `submitToFormspree()`:
```javascript
fetch('https://your-api.com/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email })
})
```

#### **Current Fallback** (Development Mode)

Emails are saved to browser `localStorage`. View in console:
```javascript
// In browser console:
JSON.parse(localStorage.getItem('landing_page_emails'))
```

### 4. Enable Google Analytics

1. Create GA4 property at [analytics.google.com](https://analytics.google.com/)
2. Get Measurement ID (format: `G-XXXXXXXXXX`)
3. Edit `index.html` lines ~31-48:
   - Uncomment the Google Analytics script
   - Replace `G-XXXXXXXXXX` with your ID

### 5. Add Your Logo

**Option 1: Icon + Text** (current)
```html
<div class="nav__logo">
    <i class="fas fa-shopping-bag"></i>
    <span>YourBrand</span>
</div>
```

**Option 2: Image Logo**
```html
<div class="nav__logo">
    <img src="assets/logo.png" alt="YourBrand" style="height: 40px;">
</div>
```

### 6. Replace Placeholder Images

Currently using:
- **Avatars:** `https://i.pravatar.cc/150?img={12,47,33}`
- **Hero:** Gradient cards (no background image)

**To use your images:**
1. Add images to `assets/` folder
2. Update `src` attributes in HTML
3. See `assets/README.md` for image guidelines

## 🔧 Advanced Customization

### Add New Section

```html
<section class="new-section section" id="new">
    <div class="container">
        <div class="section__header">
            <span class="section__tag">Section Tag</span>
            <h2 class="section__title">Section Title</h2>
        </div>
        <!-- Your content here -->
    </div>
</section>
```

Don't forget to add to navigation:
```html
<li class="nav__item">
    <a href="#new" class="nav__link">New Section</a>
</li>
```

### Modify Typography

Edit `css/styles.css` (lines ~30-45):
```css
:root {
    /* Change font sizes */
    --font-size-xl: clamp(2rem, 5vw, 2.5rem);
    --font-size-lg: clamp(1.5rem, 4vw, 2rem);
    /* etc... */
}
```

Or change font family (line ~20):
```css
body {
    font-family: 'Your Font', sans-serif;
}
```

**Popular Font Pairings:**
- **Modern:** Poppins + Open Sans
- **Professional:** Roboto + Lato
- **Elegant:** Playfair Display + Source Sans Pro

### Add Animations

All animations defined in `js/main.js`:
```javascript
// Add to init():
animateOnScroll(); // Fade-in on scroll
lazyLoadImages();  // Lazy load images
```

Custom animations in `css/styles.css`:
```css
@keyframes yourAnimation {
    from { opacity: 0; }
    to { opacity: 1; }
}
```

## 📊 Testing

### Email Form

1. Open browser console (F12)
2. Submit email in CTA form
3. Check console logs: `📧 Email saved to localStorage`
4. View saved emails:
   ```javascript
   JSON.parse(localStorage.getItem('landing_page_emails'))
   ```

### Responsive Design

Test breakpoints:
- **Desktop:** 1024px+
- **Tablet:** 768px - 1024px
- **Mobile:** < 768px

Use browser DevTools (F12 → Toggle device toolbar)

### Performance

Run Lighthouse audit (Chrome DevTools):
- Performance: >90
- Accessibility: >90
- Best Practices: >90
- SEO: >90

## 🚀 Deployment

### Option 1: Netlify (Easiest)

1. Sign up at [netlify.com](https://netlify.com/)
2. Drag & drop `landing-page` folder
3. Done! Get free HTTPS + CDN

### Option 2: Vercel

```bash
npm install -g vercel
cd landing-page
vercel
```

### Option 3: GitHub Pages

1. Push to GitHub repository
2. Settings → Pages → Source: main branch
3. Your site: `https://username.github.io/repo-name/`

### Option 4: Traditional Hosting

Upload files via FTP to:
```
public_html/
├── index.html
├── css/
├── js/
└── assets/
```

## ✅ Pre-Launch Checklist

- [ ] Update all text content (remove "ShopPro" placeholders)
- [ ] Change color scheme to match brand
- [ ] Add real testimonials + customer photos
- [ ] Update pricing plans
- [ ] Setup email backend (Formspree or API)
- [ ] Enable Google Analytics
- [ ] Add your logo
- [ ] Replace placeholder images
- [ ] Test email form functionality
- [ ] Test on mobile devices (iOS + Android)
- [ ] Test on multiple browsers (Chrome, Firefox, Safari)
- [ ] Run Lighthouse audit (score >90 on all)
- [ ] Check accessibility (keyboard navigation, screen readers)
- [ ] Add robots.txt and sitemap.xml
- [ ] Setup SSL certificate (HTTPS)
- [ ] Add favicon (already has emoji favicon)
- [ ] Update meta tags (title, description, OG tags)
- [ ] Test page load speed (<3s on 3G)

## 🐛 Troubleshooting

### Email form not working

**Problem:** Click submit, nothing happens  
**Solution:** Check browser console for errors. Make sure you configured Formspree ID or see emails in localStorage:
```javascript
localStorage.getItem('landing_page_emails')
```

### Mobile menu not closing

**Problem:** Menu stays open after clicking link  
**Solution:** JavaScript `closeMobileMenuOnClick()` should handle this. Check if `main.js` is loaded.

### Images not loading

**Problem:** Broken image icons  
**Solution:** 
- Check image paths are correct
- If using online URLs, check internet connection
- Avatars use `https://i.pravatar.cc/` - requires internet

### Smooth scroll not working

**Problem:** Page jumps instead of smooth scroll  
**Solution:** Make sure `main.js` is loaded and `smoothScrollNav()` is running.

## 📈 Analytics Dashboard

View collected data (development mode):

```javascript
// In browser console:

// View all emails
JSON.parse(localStorage.getItem('landing_page_emails'))

// View page views
localStorage.getItem('landing_page_views')

// Clear data
localStorage.clear()
```

## 🤝 Support

- **Documentation:** See this README + `assets/README.md`
- **Icons:** [Font Awesome Documentation](https://fontawesome.com/docs)
- **Formspree:** [Formspree Help Center](https://help.formspree.io/)

## 📝 License

Free to use for personal and commercial projects. Attribution appreciated but not required.

---

**Made with ❤️ for fast, conversion-focused landing pages**

Last updated: 2026-03-22
