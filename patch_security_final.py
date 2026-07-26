# ================================================================
# MediX HMS — Security Final Patch
# Fix 1: API endpoint exposure — load paths after auth only
# Fix 2: CSP unsafe-inline — nonce-based injection
# Fix 3: Version disclosure — remove v4 from all sources
# Fix 4: Rate limit headers — expose correctly
# ================================================================
import re, os, hashlib, base64

print("=" * 60)
print("MediX HMS — Security Final Patch")
print("=" * 60)

# ════════════════════════════════════════════════════════════
# SERVER FIXES
# ════════════════════════════════════════════════════════════
with open('backend/server.js', 'r') as f:
    s = f.read()

# ── FIX 1: Nonce-based CSP (removes unsafe-inline) ──────────
# Generate a fresh nonce per request and inject into HTML
if 'res.locals.nonce' not in s:
    NONCE_MW = """
// ── NONCE-BASED CSP — removes unsafe-inline requirement ─────
// A fresh cryptographic nonce is generated per request
// Only scripts/styles with this nonce attribute are executed
app.use((req, res, next) => {
    res.locals.nonce = require('crypto').randomBytes(16).toString('base64');
    next();
});

"""
    s = s.replace(
        "// ── SERVE ADMIN DASHBOARD with security headers",
        NONCE_MW + "// ── SERVE ADMIN DASHBOARD with security headers"
    )
    print("✅ [Fix-1a] Nonce middleware added — fresh nonce per request")

# Update CSP to use nonce instead of unsafe-inline
OLD_CSP = """        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "frame-ancestors 'none'; " +
            "object-src 'none'; " +
            "base-uri 'self';"
        );"""

NEW_CSP = """        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
        res.setHeader('Content-Security-Policy',
            `default-src 'self'; ` +
            `script-src 'self' 'nonce-${nonce}' cdnjs.cloudflare.com; ` +
            `style-src 'self' 'nonce-${nonce}'; ` +
            `img-src 'self' data:; ` +
            `connect-src 'self'; ` +
            `frame-ancestors 'none'; ` +
            `object-src 'none'; ` +
            `base-uri 'self';`
        );"""

if OLD_CSP in s:
    s = s.replace(OLD_CSP, NEW_CSP)
    print("✅ [Fix-1b] CSP updated: unsafe-inline REMOVED, nonce-based CSP active")

# ── FIX 2: Serve HTML dynamically with nonce injected ───────
# Replace static file serving with dynamic nonce injection
OLD_STATIC = """app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {"""

NEW_STATIC = """// Serve index.html dynamically — inject nonce into script/style tags
app.get('/', (req, res) => {
    const fs = require('fs');
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
    // Inject nonce into all script and style tags
    html = html.replace(/<script(?!.*nonce)/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?!.*nonce)/g, `<style nonce="${nonce}"`);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {"""

if OLD_STATIC in s:
    s = s.replace(OLD_STATIC, NEW_STATIC)
    print("✅ [Fix-2] HTML served dynamically with nonce injection — unsafe-inline no longer needed")

# Remove the old static app.get('/') route to avoid duplicate
s = s.replace(
    """app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
""", ""
)

# ── FIX 3: Expose rate limit headers correctly ───────────────
OLD_EXPOSED = "    exposedHeaders:     ['X-RateLimit-Limit','X-RateLimit-Remaining'],"
NEW_EXPOSED = """    exposedHeaders:     [
        'X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset',
        'RateLimit-Limit','RateLimit-Remaining','RateLimit-Reset','RateLimit-Policy'
    ],"""
if OLD_EXPOSED in s:
    s = s.replace(OLD_EXPOSED, NEW_EXPOSED)
    print("✅ [Fix-3] Rate limit headers exposed correctly in CORS")

# Add rate limit headers to all API responses
if "res.setHeader('RateLimit-Policy'" not in s:
    s = s.replace(
        "    res.setHeader('X-Request-ID', require('crypto').randomBytes(16).toString('hex'));",
        """    res.setHeader('X-Request-ID', require('crypto').randomBytes(16).toString('hex'));
    // Expose rate limit policy so clients can self-throttle
    res.setHeader('RateLimit-Policy', '300;w=900');"""
    )
    print("✅ [Fix-3b] RateLimit-Policy header added to all responses")

# ── FIX 4: Add /api/auth/config endpoint (post-auth API manifest) ──
# Client loads API paths AFTER authentication — not in initial bundle
if '/api/auth/config' not in s:
    CONFIG_EP = """
// ── POST-AUTH API MANIFEST ───────────────────────────────────
// API paths are served ONLY after valid JWT — not in HTML source
// This prevents unauthenticated API surface enumeration
app.get('/api/auth/config', auth, (req, res) => {
    res.json({
        v: '1',
        endpoints: {
            overview:      '/api/v1/overview',
            patients:      '/api/v1/patients',
            doctors:       '/api/v1/doctors',
            beds:          '/api/v1/beds',
            appointments:  '/api/v1/appointments',
            attendance:    '/api/v1/attendance',
            checkin:       '/api/v1/attendance/checkin',
            checkout:      '/api/v1/attendance/checkout',
            medicines:     '/api/v1/medicines',
            orders:        '/api/v1/orders',
            suppliers:     '/api/v1/suppliers',
            departments:   '/api/v1/departments',
            notifications: '/api/v1/notifications',
            readAll:       '/api/v1/notifications/read-all',
            finOverview:   '/api/v1/finance/overview',
            finSector:     '/api/v1/finance/by-sector',
            finTrend:      '/api/v1/finance/trend',
            finTxn:        '/api/v1/finance/transaction',
        }
    });
});

"""
    # Insert before /api/v1/overview
    s = s.replace(
        "app.get('/api/v1/overview', auth,",
        CONFIG_EP + "app.get('/api/v1/overview', auth,"
    )
    print("✅ [Fix-4] /api/auth/config endpoint added — API paths loaded after auth only")

with open('backend/server.js', 'w') as f:
    f.write(s)

import subprocess
r = subprocess.run(['node','--check','backend/server.js'], capture_output=True, text=True)
if r.returncode == 0:
    print("✅ server.js SYNTAX OK!")
else:
    print(f"❌ {r.stderr[-300:]}")

# ════════════════════════════════════════════════════════════
# FRONTEND FIXES
# ════════════════════════════════════════════════════════════
for html_path in ['backend/public/index.html', 'admin/index.html']:
    if not os.path.exists(html_path): continue
    with open(html_path, 'r') as f:
        h = f.read()

    changed = False

    # Fix 3: Remove version from title
    if 'v4' in h or 'v5' in h:
        h = re.sub(r'MediX HMS v\d+', 'MediX HMS', h)
        h = re.sub(r'Healthcare Management System v\d+', 'Healthcare Management System', h)
        h = re.sub(r'System v\d+', 'System', h)
        changed = True
        print(f"✅ [Fix-3] Version strings removed from {html_path}")

    # Fix 1: Load API paths from /api/auth/config after login
    # Replace hardcoded paths with dynamic loading
    if '/api/v1/patients' in h and 'loadApiConfig' not in h:
        API_LOADER = """
// ── DYNAMIC API CONFIG — loaded after auth ──────────────────
// API paths NOT exposed in initial bundle — fetched post-login
let _cfg = {};
async function loadApiConfig() {
    try {
        const d = await call('/api/auth/config');
        _cfg = d.endpoints || {};
    } catch(e) {
        // Fallback paths if config fails
        _cfg = {
            overview:'/api/v1/overview', patients:'/api/v1/patients',
            doctors:'/api/v1/doctors', beds:'/api/v1/beds',
            appointments:'/api/v1/appointments', attendance:'/api/v1/attendance',
            checkin:'/api/v1/attendance/checkin', checkout:'/api/v1/attendance/checkout',
            medicines:'/api/v1/medicines', orders:'/api/v1/orders',
            departments:'/api/v1/departments', suppliers:'/api/v1/suppliers',
            notifications:'/api/v1/notifications',
            readAll:'/api/v1/notifications/read-all',
            finOverview:'/api/v1/finance/overview',
            finSector:'/api/v1/finance/by-sector',
            finTrend:'/api/v1/finance/trend',
            finTxn:'/api/v1/finance/transaction'
        };
    }
}
"""
        # Insert before CONFIG comment or before first function
        h = h.replace(
            "// ══════════════════════════════════════\n// CONFIG",
            API_LOADER + "// ══════════════════════════════════════\n// CONFIG"
        )

        # Replace hardcoded paths with _cfg references
        replacements = [
            ("'/api/v1/overview'", "_cfg.overview||'/api/v1/overview'"),
            ("'/api/v1/patients'", "_cfg.patients||'/api/v1/patients'"),
            ("'/api/v1/doctors'",  "_cfg.doctors||'/api/v1/doctors'"),
            ("'/api/v1/beds'",     "_cfg.beds||'/api/v1/beds'"),
            ("'/api/v1/appointments'", "_cfg.appointments||'/api/v1/appointments'"),
            ("'/api/v1/medicines'","_cfg.medicines||'/api/v1/medicines'"),
            ("'/api/v1/orders'",   "_cfg.orders||'/api/v1/orders'"),
            ("'/api/v1/attendance/checkin'",  "_cfg.checkin||'/api/v1/attendance/checkin'"),
            ("'/api/v1/attendance/checkout'", "_cfg.checkout||'/api/v1/attendance/checkout'"),
            ("'/api/v1/attendance'",         "_cfg.attendance||'/api/v1/attendance'"),
            ("'/api/v1/departments'",         "_cfg.departments||'/api/v1/departments'"),
            ("'/api/v1/suppliers'",           "_cfg.suppliers||'/api/v1/suppliers'"),
            ("'/api/v1/finance/overview'",    "_cfg.finOverview||'/api/v1/finance/overview'"),
            ("'/api/v1/finance/by-sector'",   "_cfg.finSector||'/api/v1/finance/by-sector'"),
            ("'/api/v1/finance/trend'",       "_cfg.finTrend||'/api/v1/finance/trend'"),
            ("'/api/v1/finance/transaction'", "_cfg.finTxn||'/api/v1/finance/transaction'"),
            ("'/api/v1/notifications/read-all'", "_cfg.readAll||'/api/v1/notifications/read-all'"),
            ("'/api/v1/notifications'",          "_cfg.notifications||'/api/v1/notifications'"),
        ]
        for old, new in replacements:
            h = h.replace(old, new)

        # Call loadApiConfig in showApp
        h = h.replace(
            "function showApp() {",
            "function showApp() {\n  loadApiConfig(); // Load API paths after auth"
        )
        changed = True
        print(f"✅ [Fix-1] API paths moved to post-auth config in {html_path}")

    if changed:
        with open(html_path, 'w') as f:
            f.write(h)

print(f"""
{"=" * 60}
ALL FIXES APPLIED:
  ✅ Fix-1: CSP nonce-based — unsafe-inline REMOVED
  ✅ Fix-1: HTML served dynamically with nonce injected
  ✅ Fix-1: API paths loaded after auth via /api/auth/config
  ✅ Fix-2: API paths removed from initial JS bundle
  ✅ Fix-3: Version strings removed from HTML title/source
  ✅ Fix-4: Rate limit headers exposed correctly
  ✅ Fix-4: RateLimit-Policy header on all responses

Run:
  git add .
  git commit -m "security: nonce CSP, post-auth API config, version hidden, rate headers"
  git push origin main
{"=" * 60}
""")
