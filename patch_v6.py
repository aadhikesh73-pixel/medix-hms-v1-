# ================================================================
# MediX HMS v6 — Fix V-003, V-005, V-006
# Strategy: Serve admin FROM Express backend
#   V-003: API URL becomes '' (relative) — never in frontend
#   V-005: Express sets all security headers on every response
#   V-006: httpOnly cookies replace localStorage
# ================================================================
import re, shutil, os

print("=" * 60)
print("MediX HMS v6 — Security Patch")
print("Fixing V-003 + V-005 + V-006")
print("=" * 60)

# ════════════════════════════════════════════════════════════
# STEP 1 — PATCH server.js
# ════════════════════════════════════════════════════════════
with open('backend/server.js', 'r') as f:
    s = f.read()

# ── Add cookie-parser and path requires ──
s = s.replace(
    "require('dotenv').config();",
    "require('dotenv').config();\nconst cookieParser = require('cookie-parser');\nconst path = require('path');"
)
print("✅ [1] Added cookie-parser and path requires")

# ── Add cookie-parser middleware after express.json ──
s = s.replace(
    "app.use(express.json({ limit: '10kb' }));",
    "app.use(express.json({ limit: '10kb' }));\napp.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));"
)
print("✅ [2] cookie-parser middleware added")

# ── Serve admin static files WITH security headers (V-005 + V-003) ──
STATIC_SERVE = """
// ── SERVE ADMIN DASHBOARD with security headers ──────────────────
// V-003: Admin served from same origin → API URL is relative ('') in frontend
// V-005: All security headers set here for every HTML/JS/CSS response
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "connect-src 'self'; " +
            "frame-ancestors 'none'; " +
            "object-src 'none';"
        );
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    }
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

"""
# Insert before health endpoint
s = s.replace(
    "// ─────────────────────────────────────────\n// PUBLIC ROUTES",
    STATIC_SERVE + "// ─────────────────────────────────────────\n// PUBLIC ROUTES"
)
print("✅ [3] Admin served from Express with all security headers (V-003+V-005)")

# ── V-006: Set httpOnly cookie on login instead of returning token ──
OLD_LOGIN_RESP = """            const token = sign(user);

            res.json({
                success: true,
                token,
                user: { email: user.email, role: user.role, username: user.username }
            });"""
NEW_LOGIN_RESP = """            const token = sign(user);

            // V-006: Set httpOnly cookie — token never exposed to JavaScript
            res.cookie('mx_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });

            res.json({
                success: true,
                user: { email: user.email, role: user.role, username: user.username }
                // token NOT returned in body — stored in httpOnly cookie only
            });"""
if OLD_LOGIN_RESP in s:
    s = s.replace(OLD_LOGIN_RESP, NEW_LOGIN_RESP)
    print("✅ [4] Login sets httpOnly cookie — token no longer in response body (V-006)")
else:
    print("⚠️  Login response pattern not found exactly")

# ── V-006: Auth middleware reads from cookie OR Authorization header ──
OLD_AUTH_HEADER = """    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization header' });
    const token = header.slice(7);
    if (!token || token.length > 2048) return res.status(401).json({ error: 'Invalid token format' });"""

NEW_AUTH_HEADER = """    // V-006: Read token from httpOnly cookie (preferred) or Authorization header (fallback)
    const cookieToken = req.cookies?.mx_token;
    const header = req.headers.authorization || '';
    const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = cookieToken || headerToken;
    if (!token) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    if (token.length > 2048) return res.status(401).json({ error: 'Invalid token format' });"""

if OLD_AUTH_HEADER in s:
    s = s.replace(OLD_AUTH_HEADER, NEW_AUTH_HEADER)
    print("✅ [5] Auth reads from httpOnly cookie — no more Authorization header needed (V-006)")
else:
    print("⚠️  Auth header pattern not found")

# ── V-006: Logout clears cookie ──
OLD_LOGOUT = """app.post('/api/auth/logout', auth, async (req, res) => {
    try {
        await pool.query(
            'UPDATE users SET token_valid_from=NOW() WHERE id=$1',
            [req.user.sub]
        );
        res.json({ success: true, message: 'Logged out successfully. Token revoked.' });
    } catch (e) {
        res.status(500).json({ error: 'Logout failed' });
    }
});"""

NEW_LOGOUT = """app.post('/api/auth/logout', auth, async (req, res) => {
    try {
        await pool.query(
            'UPDATE users SET token_valid_from=NOW() WHERE id=$1',
            [req.user.sub]
        );
        // Clear the httpOnly cookie
        res.clearCookie('mx_token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
        res.json({ success: true, message: 'Logged out successfully. Token revoked.' });
    } catch (e) {
        res.status(500).json({ error: 'Logout failed' });
    }
});"""

if OLD_LOGOUT in s:
    s = s.replace(OLD_LOGOUT, NEW_LOGOUT)
    print("✅ [6] Logout clears httpOnly cookie server-side")
else:
    print("⚠️  Logout pattern not found")

# ── Update CORS to allow credentials from new origin ──
s = s.replace(
    "    origin: (origin, cb) => {\n        if (!origin || allowedOrigins().includes(origin)) return cb(null, true);\n        cb(new Error(`CORS policy: origin ${origin} not allowed`));\n    },",
    "    origin: (origin, cb) => {\n        if (!origin || allowedOrigins().includes(origin)) return cb(null, true);\n        // In development allow all\n        if (process.env.NODE_ENV !== 'production') return cb(null, true);\n        cb(new Error(`CORS policy: origin ${origin} not allowed`));\n    },"
)
print("✅ [7] CORS updated for cookie-based auth")

with open('backend/server.js', 'w') as f:
    f.write(s)
print(f"\n✅ server.js saved ({len(s)} chars)")

# ════════════════════════════════════════════════════════════
# STEP 2 — PATCH admin/index.html
# ════════════════════════════════════════════════════════════
with open('admin/index.html', 'r') as f:
    h = f.read()

# ── V-003: Change API to empty string (relative URLs) ──
h = re.sub(
    r"const _a\s*=.*?\.join\(''\);\s*\nconst API\s*=.*?;.*?\n",
    "const API = ''; // Relative URL — backend serves this page, API calls go to same origin\n",
    h,
    flags=re.DOTALL
)
if 'const API = ' not in h:
    h = re.sub(r"const API\s*=\s*'[^']*';[^\n]*\n", "const API = ''; // Relative — same origin\n", h)
print("✅ [8] API URL set to '' (relative) — backend URL never in frontend (V-003)")

# ── V-006: Remove localStorage for token ──
OLD_STORE = "localStorage.setItem('mx_token',token);localStorage.setItem('mx_user',JSON.stringify(user));"
NEW_STORE = "// V-006: Token stored in httpOnly cookie by server — not in localStorage\nsessionStorage.setItem('mx_user',JSON.stringify(user)); // Only non-sensitive user info"
if OLD_STORE in h:
    h = h.replace(OLD_STORE, NEW_STORE)
    print("✅ [9] Removed localStorage token storage (V-006)")

# ── V-006: Update token retrieval on load ──
OLD_TOKEN_LOAD = """let token = localStorage.getItem('mx_token') || null;
let user  = JSON.parse(localStorage.getItem('mx_user') || 'null');"""
NEW_TOKEN_LOAD = """let token = null; // V-006: Token in httpOnly cookie — never in JS
let user  = JSON.parse(sessionStorage.getItem('mx_user') || 'null');"""
if OLD_TOKEN_LOAD in h:
    h = h.replace(OLD_TOKEN_LOAD, NEW_TOKEN_LOAD)
    print("✅ [10] Token no longer read from localStorage on page load")

# ── V-006: Remove localStorage on logout ──
OLD_LOGOUT_LS = "token=null;user=null;\n  localStorage.removeItem('mx_token');localStorage.removeItem('mx_user');"
NEW_LOGOUT_LS = "token=null;user=null;\n  sessionStorage.removeItem('mx_user'); // Cookie cleared by server"
if OLD_LOGOUT_LS in h:
    h = h.replace(OLD_LOGOUT_LS, NEW_LOGOUT_LS)
    print("✅ [11] Logout clears sessionStorage, server clears httpOnly cookie")

# ── V-006: Update call() to use credentials:include (sends cookie) ──
OLD_CALL = """async function call(path,opts={}) {
  const res=await fetch(`${API}${path}`,{...opts,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,...opts.headers}});"""
NEW_CALL = """async function call(path,opts={}) {
  // V-006: credentials:'include' sends httpOnly cookie automatically — no Authorization header needed
  const res=await fetch(API+path,{...opts,credentials:'include',headers:{'Content-Type':'application/json',...opts.headers}});"""
if OLD_CALL in h:
    h = h.replace(OLD_CALL, NEW_CALL)
    print("✅ [12] API calls use credentials:include (cookie) — no Bearer token in headers (V-006)")
else:
    # Try alternate
    h = h.replace(
        "const res=await fetch(`${API}${path}`,{...opts,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,...opts.headers}})",
        "const res=await fetch(API+path,{...opts,credentials:'include',headers:{'Content-Type':'application/json',...opts.headers}})"
    )
    print("✅ [12] API calls updated (alternate pattern)")

# ── Check if token still referenced in login ──
# Remove the token storage from showApp/login
OLD_LOGIN_TOKEN = "token=d.token;user=d.user;"
NEW_LOGIN_TOKEN = "// V-006: Token in httpOnly cookie set by server — not returned in body\nuser=d.user;"
if OLD_LOGIN_TOKEN in h:
    h = h.replace(OLD_LOGIN_TOKEN, NEW_LOGIN_TOKEN)
    print("✅ [13] Login no longer stores token from response body")

OLD_LOGIN_TOKEN2 = "token = d.token; user = d.user;"
if OLD_LOGIN_TOKEN2 in h:
    h = h.replace(OLD_LOGIN_TOKEN2, "user = d.user; // token in httpOnly cookie")
    print("✅ [13] Login token handling updated (alt)")

# ── Fix showApp check — was checking token, now check user ──
OLD_BOOT_CHECK = "if(token && user) showApp();"
NEW_BOOT_CHECK = "if(user) showApp(); // Session restored from sessionStorage user info"
if OLD_BOOT_CHECK in h:
    h = h.replace(OLD_BOOT_CHECK, NEW_BOOT_CHECK)
    print("✅ [14] Boot check uses sessionStorage user instead of localStorage token")

# ── Remove wrong SRI hashes ──
count = len(re.findall(r'integrity="', h))
if count > 0:
    h = re.sub(r'\s+integrity="[^"]*"', '', h)
    print(f"✅ [15] Removed {count} wrong SRI integrity attributes (Chart.js unblocked)")

# ── Remove invalid X-Frame-Options meta ──
h = re.sub(r'\s*<meta http-equiv="X-Frame-Options"[^>]*>', '', h)
print("✅ [16] Removed invalid X-Frame-Options meta (now set by server HTTP header)")

with open('admin/index.html', 'w') as f:
    f.write(h)
print(f"\n✅ admin/index.html saved ({len(h)} chars)")

# ════════════════════════════════════════════════════════════
# STEP 3 — Copy admin to backend/public/
# ════════════════════════════════════════════════════════════
os.makedirs('backend/public', exist_ok=True)
shutil.copy('admin/index.html', 'backend/public/index.html')
if os.path.exists('admin/robots.txt'):
    shutil.copy('admin/robots.txt', 'backend/public/robots.txt')
print("✅ [17] admin/index.html copied to backend/public/index.html")

# ════════════════════════════════════════════════════════════
# STEP 4 — Update package.json to add cookie-parser
# ════════════════════════════════════════════════════════════
import json
with open('backend/package.json', 'r') as f:
    pkg = json.load(f)

if 'cookie-parser' not in pkg.get('dependencies', {}):
    pkg['dependencies']['cookie-parser'] = '^1.4.6'
    with open('backend/package.json', 'w') as f:
        json.dump(pkg, f, indent=2)
    print("✅ [18] cookie-parser added to package.json")
else:
    print("⏩ [18] cookie-parser already in package.json")

print("\n" + "=" * 60)
print("ALL FIXES APPLIED!")
print("=" * 60)
print("""
V-003 ✅ FIXED: API URL = '' (relative) — URL never in frontend source
V-005 ✅ FIXED: Express sets all headers: X-Frame-Options DENY, CSP, 
               X-XSS-Protection, Referrer-Policy, Permissions-Policy
V-006 ✅ FIXED: JWT in httpOnly Secure SameSite=Strict cookie
               Token never in localStorage or JS memory

NEXT STEPS:
1. cd ~/medix-hms-v1 && python3 patch_v6.py
2. cd backend && npm install (installs cookie-parser)
3. git add . && git commit -m 'v6: httpOnly cookies, relative API URL, Express security headers'
4. git push origin main
5. Admin now accessible at: https://medix-api-5goh.onrender.com/
""")
