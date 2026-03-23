/**
 * ShopPro Landing Page - Main JavaScript
 * Interactive features: smooth scroll, mobile menu, form validation, lazy loading, scroll-to-top
 */

'use strict';

// ===================================
// GLOBAL ELEMENTS
// ===================================
const navMenu = document.getElementById('nav-menu');
const navToggle = document.getElementById('nav-toggle');
const navLinks = document.querySelectorAll('.nav__link');
const scrollTopBtn = document.getElementById('scroll-top');
const ctaForm = document.getElementById('cta-form');
const header = document.getElementById('header');

// ===================================
// MOBILE MENU TOGGLE
// ===================================
function toggleMobileMenu() {
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('show');
            
            // Toggle hamburger to X icon
            const icon = navToggle.querySelector('i');
            if (navMenu.classList.contains('show')) {
                icon.classList.replace('fa-bars', 'fa-times');
            } else {
                icon.classList.replace('fa-times', 'fa-bars');
            }
        });
    }
}

// ===================================
// CLOSE MOBILE MENU ON LINK CLICK
// ===================================
function closeMobileMenuOnClick() {
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu.classList.contains('show')) {
                navMenu.classList.remove('show');
                const icon = navToggle.querySelector('i');
                icon.classList.replace('fa-times', 'fa-bars');
            }
        });
    });
}

// ===================================
// SMOOTH SCROLL NAVIGATION
// ===================================
function smoothScrollNav() {
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            
            // Only handle internal anchor links
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetSection = document.getElementById(targetId);
                
                if (targetSection) {
                    const headerHeight = header.offsetHeight;
                    const targetPosition = targetSection.offsetTop - headerHeight;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

// ===================================
// ACTIVE NAVIGATION LINK ON SCROLL
// ===================================
function activateNavOnScroll() {
    const sections = document.querySelectorAll('.section');
    
    window.addEventListener('scroll', () => {
        const scrollY = window.pageYOffset;
        const headerHeight = header.offsetHeight;
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop - headerHeight - 100;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');
            
            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    });
}

// ===================================
// SCROLL TO TOP BUTTON
// ===================================
function handleScrollTopButton() {
    if (!scrollTopBtn) return;
    
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 400) {
            scrollTopBtn.classList.add('show');
        } else {
            scrollTopBtn.classList.remove('show');
        }
    });
    
    scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// ===================================
// STICKY HEADER ON SCROLL
// ===================================
function stickyHeader() {
    if (!header) return;
    
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 100) {
            header.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        } else {
            header.style.boxShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';
        }
    });
}

// ===================================
// EMAIL FORM VALIDATION
// ===================================
function validateEmailForm() {
    if (!ctaForm) return;
    
    ctaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const emailInput = ctaForm.querySelector('#email');
        const email = emailInput.value.trim();
        
        // Email validation regex
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!email) {
            showFormMessage('Vui lòng nhập email của bạn', 'error');
            emailInput.focus();
            return;
        }
        
        if (!emailRegex.test(email)) {
            showFormMessage('Email không hợp lệ. Vui lòng kiểm tra lại.', 'error');
            emailInput.focus();
            return;
        }
        
        // Success - Here you would typically send to backend
        showFormMessage('✓ Đăng ký thành công! Chúng tôi sẽ liên hệ sớm.', 'success');
        
        // Clear form
        emailInput.value = '';
        
        // CUSTOMIZE: Integrate with your backend API
        // Example:
        // fetch('/api/subscribe', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ email })
        // })
        // .then(response => response.json())
        // .then(data => {
        //     if (data.success) {
        //         showFormMessage('✓ Đăng ký thành công!', 'success');
        //     }
        // })
        // .catch(error => {
        //     showFormMessage('Có lỗi xảy ra. Vui lòng thử lại.', 'error');
        // });
        
        // Alternative: Use form services like Formspree, EmailJS
        // submitToFormspree(email);
    });
}

// ===================================
// SHOW FORM MESSAGE
// ===================================
function showFormMessage(message, type) {
    // Remove existing message if any
    const existingMsg = document.querySelector('.form__message');
    if (existingMsg) {
        existingMsg.remove();
    }
    
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `form__message form__message--${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        margin-top: 1rem;
        padding: 1rem;
        border-radius: 8px;
        text-align: center;
        font-weight: 500;
        background: ${type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'};
        color: ${type === 'success' ? '#16A34A' : '#DC2626'};
        animation: slideDown 0.3s ease;
    `;
    
    ctaForm.appendChild(messageDiv);
    
    // Remove message after 5 seconds
    setTimeout(() => {
        messageDiv.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 5000);
}

// ===================================
// LAZY LOADING IMAGES (if you add images later)
// ===================================
function lazyLoadImages() {
    const images = document.querySelectorAll('img[data-src]');
    
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    observer.unobserve(img);
                }
            });
        });
        
        images.forEach(img => imageObserver.observe(img));
    } else {
        // Fallback for older browsers
        images.forEach(img => {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        });
    }
}

// ===================================
// ANIMATE ON SCROLL (AOS)
// ===================================
function animateOnScroll() {
    const animatedElements = document.querySelectorAll('.feature__card, .pricing__card, .testimonial__card');
    
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });
        
        animatedElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });
    }
}

// ===================================
// HELPER: Submit to Formspree (example)
// ===================================
function submitToFormspree(email) {
    // PRODUCTION: Replace 'YOUR_FORM_ID' with your actual Formspree form ID
    // Get it from https://formspree.io/
    // Example: const FORMSPREE_ID = 'xpznabcd';
    const FORMSPREE_ID = 'YOUR_FORM_ID';
    
    if (FORMSPREE_ID === 'YOUR_FORM_ID') {
        // Fallback: Use local storage + mailto for development
        submitToLocalStorage(email);
        return;
    }
    
    fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: email,
            _subject: 'New signup from landing page',
            timestamp: new Date().toISOString()
        })
    })
    .then(response => {
        if (response.ok) {
            showFormMessage('✓ Đăng ký thành công! Chúng tôi sẽ liên hệ sớm.', 'success');
            trackEvent('email_signup', { email: email });
        } else {
            throw new Error('Form submission failed');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Có lỗi xảy ra. Vui lòng thử lại sau.', 'error');
        // Fallback to local storage on error
        submitToLocalStorage(email);
    });
}

// ===================================
// FALLBACK: Submit to Local Storage
// ===================================
function submitToLocalStorage(email) {
    try {
        // Store emails in localStorage
        const emails = JSON.parse(localStorage.getItem('landing_page_emails') || '[]');
        emails.push({
            email: email,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });
        localStorage.setItem('landing_page_emails', JSON.stringify(emails));
        
        showFormMessage('✓ Đăng ký thành công! Email đã được lưu.', 'success');
        console.log('📧 Email saved to localStorage:', email);
        console.log('📊 Total emails:', emails.length);
        
        // Optional: Open mailto link for admin notification
        // window.location.href = `mailto:admin@example.com?subject=New Signup&body=Email: ${email}`;
    } catch (error) {
        console.error('localStorage error:', error);
        showFormMessage('✓ Cảm ơn bạn đã đăng ký!', 'success'); // Still show success to user
    }
}

// ===================================
// KEYBOARD ACCESSIBILITY
// ===================================
function enhanceAccessibility() {
    // Trap focus in mobile menu when open
    if (navMenu && navToggle) {
        navToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navToggle.click();
            }
        });
    }
    
    // Allow ESC to close mobile menu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navMenu.classList.contains('show')) {
            navMenu.classList.remove('show');
            const icon = navToggle.querySelector('i');
            icon.classList.replace('fa-times', 'fa-bars');
        }
    });
}

// ===================================
// PERFORMANCE: Debounce scroll events
// ===================================
function debounce(func, wait = 10) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Apply debounce to scroll handlers
const debouncedActivateNav = debounce(activateNavOnScroll, 50);
const debouncedStickyHeader = debounce(stickyHeader, 50);

// ===================================
// ANALYTICS TRACKING (optional)
// ===================================
function trackEvents() {
    // Track CTA button clicks
    const ctaButtons = document.querySelectorAll('.btn--primary');
    ctaButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // CUSTOMIZE: Add your analytics tracking
            // Example with Google Analytics:
            // gtag('event', 'click', {
            //     'event_category': 'CTA',
            //     'event_label': btn.textContent.trim()
            // });
            
            console.log('CTA clicked:', btn.textContent.trim());
        });
    });
    
    // Track pricing card clicks
    const pricingButtons = document.querySelectorAll('.pricing__card .btn');
    pricingButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const planName = btn.closest('.pricing__card').querySelector('.pricing__name').textContent;
            console.log('Pricing plan selected:', planName);
            trackEvent('pricing_click', { plan: planName });
        });
    });
}

// ===================================
// HELPER: Track Analytics Event
// ===================================
function trackEvent(eventName, params = {}) {
    // Google Analytics (if enabled)
    if (typeof gtag !== 'undefined') {
        gtag('event', eventName, params);
    }
    
    // Console log for debugging
    console.log('📊 Event:', eventName, params);
    
    // Custom backend tracking (if needed)
    // fetch('/api/track', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ event: eventName, params, timestamp: new Date().toISOString() })
    // });
}

// ===================================
// ADD CSS ANIMATIONS
// ===================================
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    @keyframes slideUp {
        from {
            opacity: 1;
            transform: translateY(0);
        }
        to {
            opacity: 0;
            transform: translateY(-10px);
        }
    }
`;
document.head.appendChild(style);

// ===================================
// INITIALIZE ALL FEATURES
// ===================================
function init() {
    console.log('🚀 ShopPro Landing Page initialized');
    
    // Navigation
    toggleMobileMenu();
    closeMobileMenuOnClick();
    smoothScrollNav();
    activateNavOnScroll();
    
    // UI Enhancements
    handleScrollTopButton();
    stickyHeader();
    animateOnScroll();
    
    // Forms
    validateEmailForm();
    
    // Images (if you add them later)
    lazyLoadImages();
    
    // Accessibility
    enhanceAccessibility();
    
    // Analytics (optional)
    trackEvents();
}

// ===================================
// RUN ON DOM READY
// ===================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ===================================
// EXPORT FOR TESTING (optional)
// ===================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        toggleMobileMenu,
        smoothScrollNav,
        validateEmailForm,
        showFormMessage,
        lazyLoadImages
    };
}
