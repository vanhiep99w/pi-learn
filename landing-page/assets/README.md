# Assets Directory

This folder contains all images and icons for the landing page.

## Structure

```
assets/
├── hero-bg.jpg          # Hero section background (recommended: 1920x1080px)
├── avatars/             # Testimonial avatars (150x150px)
│   ├── avatar-1.jpg     # Customer 1
│   ├── avatar-2.jpg     # Customer 2
│   └── avatar-3.jpg     # Customer 3
└── icons/               # Custom feature icons (optional, using Font Awesome by default)
    ├── analytics.svg    # Analytics icon
    ├── automation.svg   # Automation icon
    ├── integration.svg  # Integration icon
    ├── reporting.svg    # Reporting icon
    ├── security.svg     # Security icon
    └── support.svg      # Support icon
```

## Image Guidelines

### Hero Background
- **Size:** 1920x1080px or larger
- **Format:** JPG (optimized, <500KB)
- **Content:** Dashboard screenshot, team collaboration, or product showcase
- **Fallback:** Currently using gradient background

### Testimonial Avatars
- **Size:** 150x150px (square)
- **Format:** JPG or PNG
- **Content:** Professional headshots of customers
- **Fallback:** Using [Pravatar](https://i.pravatar.cc/) placeholder service

### Feature Icons
- **Size:** 64x64px
- **Format:** SVG (preferred) or PNG
- **Content:** Simple, line-style icons matching brand
- **Fallback:** Using Font Awesome icons (already integrated)

## Placeholder Services (For Development)

```html
<!-- Hero Image -->
<img src="https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200" alt="Dashboard">

<!-- Avatars -->
<img src="https://i.pravatar.cc/150?img=1" alt="Customer 1">
<img src="https://i.pravatar.cc/150?img=2" alt="Customer 2">
<img src="https://i.pravatar.cc/150?img=3" alt="Customer 3">
```

## Production Checklist

- [ ] Replace all placeholder images with real assets
- [ ] Optimize images (use ImageOptim, TinyPNG, or similar)
- [ ] Add proper alt text for accessibility
- [ ] Implement lazy loading (already in main.js)
- [ ] Test on different screen sizes
- [ ] Compress hero image to <500KB
- [ ] Use WebP format with JPG fallback for better performance

## Image Optimization Tools

- **Online:** [TinyPNG](https://tinypng.com/), [Squoosh](https://squoosh.app/)
- **CLI:** `imageoptim`, `sharp`, `cwebp`
- **CDN:** Consider using Cloudinary or Imgix for automatic optimization
