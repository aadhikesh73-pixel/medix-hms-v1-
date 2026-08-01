import re, os, subprocess

print("=" * 60)
print("MediX HMS — Consolidated Fix v2")
print("=" * 60)

with open('backend/server.js', 'r') as f:
    s = f.read()

FIXES_JS = []

FIXES_JS.append(("FIX-A1", """    res.status(err.status || 500).json({ error: 'Internal server error' });
});
    }
    // Add CORS headers on errors for whitelisted origins only
    const origin = req.headers.origin;
    const allowed = ['https://medix-admin.onrender.com','https://medix-patient.onrender.com',
                     'https://medix-mobile.onrender.com','https://medix-api-5goh.onrender.com'];
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    const status = err.status || 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Request failed' });
});

// 404 handler — prevent path traversal info leakage
// Handle OPTIONS preflight — always returns 2xx or 4xx, NEVER 500
app.options('*', (req, res) => {""", """    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Handle OPTIONS preflight — always returns 2xx or 4xx, NEVER 500
app.options('*', (req, res) => {"""))

FIXES_JS.append(("FIX-A2", """        return res.status(403).end();
    }
});
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));""", """        return res.status(403).end();
    }
});

// 404 handler — prevent path traversal info leakage
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));"""))

FIXES_JS.append(("FIX-B", """app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ captcha_id: id, question: c.q });
});
    res.json({ captcha_id: id, question: challenge.q });
});""", """app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ captcha_id: id, question: c.q });
});"""))

FIXES_JS.append(("FIX-C", """    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);""", """    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const GENERIC_AUTH_ERROR = 'Authentication failed. Please verify your credentials and try again.';

            const turnstileToken = req.body?.turnstile_token || '';
            const captcha_id = typeof req.body?.captcha_id === 'string' ? req.body.captcha_id : '';
            const captcha_answer = typeof req.body?.captcha_answer !== 'undefined' ? String(req.body.captcha_answer) : '';

            const turnstileResult = await verifyTurnstile(turnstileToken, req.ip);
            if (turnstileResult === true) {
                // Turnstile passed
            } else if (turnstileResult === null) {
                if (!captcha_id || !captcha_answer) {
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
                const captchaData = captchaStore.get(captcha_id);
                if (!captchaData || Date.now() > captchaData.expires) {
                    captchaStore.delete(captcha_id);
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
                const captchaOk = captcha_answer.toUpperCase().trim() === String(captchaData.answer).toUpperCase();
                captchaStore.delete(captcha_id);
                if (!captchaOk) {
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
            } else {
                return res.status(400).json({ error: GENERIC_AUTH_ERROR });
            }

            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);"""))

FIXES_JS.append(("FIX-D", """    const nonce = res.locals.nonce;
    const htmlFile = authenticated ? 'index.html' : 'login.html';
    const htmlPath = path.join(__dirname, 'public', htmlFile);
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/<script(?!.*nonce)/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?!.*nonce)/g, `<style nonce="${nonce}"`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
});""", """    const nonce = res.locals.nonce;
    const htmlFile = authenticated ? 'index.html' : 'login.html';
    const htmlPath = path.join(__dirname, 'public', htmlFile);
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/<script(?!.*nonce)/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?!.*nonce)/g, `<style nonce="${nonce}"`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Security-Policy',
        `default-src 'self'; ` +
        `script-src 'self' 'nonce-${nonce}' cdnjs.cloudflare.com challenges.cloudflare.com; ` +
        `style-src 'self' 'unsafe-inline'; ` +
        `img-src 'self' data:; ` +
        `connect-src 'self'; ` +
        `frame-src challenges.cloudflare.com; ` +
        `frame-ancestors 'none'; ` +
        `object-src 'none'; ` +
        `base-uri 'self';`
    );
    res.send(html);
});"""))

FIXES_JS.append(("FIX-E", """        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
        res.setHeader('Content-Security-Policy',
            `default-src 'self'; ` +
            `script-src 'self' 'nonce-${nonce}' cdnjs.cloudflare.com; ` +
            `style-src 'self' 'nonce-${nonce}'; ` +
            `img-src 'self' data:; ` +
            `connect-src 'self'; ` +
            `frame-ancestors 'none'; ` +
            `object-src 'none'; ` +
            `base-uri 'self';`
        );""", """        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
        res.setHeader('Content-Security-Policy',
            `default-src 'self'; ` +
            `script-src 'self' 'nonce-${nonce}' cdnjs.cloudflare.com challenges.cloudflare.com; ` +
            `style-src 'self' 'unsafe-inline'; ` +
            `img-src 'self' data:; ` +
            `connect-src 'self'; ` +
            `frame-src challenges.cloudflare.com; ` +
            `frame-ancestors 'none'; ` +
            `object-src 'none'; ` +
            `base-uri 'self';`
        );"""))

FIXES_JS.append(("FIX-F", """            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["'none'"],
            objectSrc:      ["'none'"],""", """            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "challenges.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["challenges.cloudflare.com"],
            objectSrc:      ["'none'"],"""))

FIXES_JS.append(("FIX-I1", """        `style-src 'self' 'nonce-${nonce}'; ` +""", """        `style-src 'self' 'unsafe-inline'; ` +"""))
FIXES_JS.append(("FIX-I2", """            `style-src 'self' 'nonce-${nonce}'; ` +""", """            `style-src 'self' 'unsafe-inline'; ` +"""))

for name, old, new in FIXES_JS:
    if old in s:
        s = s.replace(old, new)
        print(f"✅ [{name}] applied")
    else:
        print(f"⏩ [{name}] not found — already fixed or file differs")

with open('backend/server.js', 'w') as f:
    f.write(s)

r = subprocess.run(['node', '--check', 'backend/server.js'], capture_output=True, text=True)
print("✅ backend/server.js — SYNTAX OK" if r.returncode == 0 else f"❌ SYNTAX ERROR:\n{r.stderr}")

OLD_G = """    document.getElementById('capA').value='';
  }
} ${op} ${b} = ?`;
  document.getElementById('capA').value='';
  document.getElementById('capErr').style.display='none';
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════"""
NEW_G = """    document.getElementById('capA').value='';
  }
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════"""

OLD_H = "function showApp() {"
NEW_H = """// ── DYNAMIC API CONFIG — loaded after auth ──────────────────
let _cfg = {};
async function loadApiConfig() {
    try {
        const d = await call('/api/auth/config');
        _cfg = d.endpoints || {};
    } catch (e) {
        _cfg = {
            overview: '/api/v1/overview', patients: '/api/v1/patients',
            doctors: '/api/v1/doctors', beds: '/api/v1/beds',
            appointments: '/api/v1/appointments', attendance: '/api/v1/attendance',
            checkin: '/api/v1/attendance/checkin', checkout: '/api/v1/attendance/checkout',
            medicines: '/api/v1/medicines', orders: '/api/v1/orders',
            departments: '/api/v1/departments', suppliers: '/api/v1/suppliers',
            notifications: '/api/v1/notifications',
            readAll: '/api/v1/notifications/read-all',
            finOverview: '/api/v1/finance/overview',
            finSector: '/api/v1/finance/by-sector',
            finTrend: '/api/v1/finance/trend',
            finTxn: '/api/v1/finance/transaction'
        };
    }
}

function showApp() {"""

for html_path in ['admin/index.html', 'backend/public/index.html']:
    if not os.path.exists(html_path):
        print(f"⏩ {html_path} not found — skipping")
        continue
    with open(html_path, 'r') as f:
        h = f.read()
    changed = False
    if OLD_G in h:
        h = h.replace(OLD_G, NEW_G)
        print(f"✅ [FIX-G] genCap() fragment removed in {html_path}")
        changed = True
    else:
        print(f"⏩ [FIX-G] not found in {html_path}")
    if 'async function loadApiConfig' not in h and OLD_H in h:
        h = h.replace(OLD_H, NEW_H)
        print(f"✅ [FIX-H] loadApiConfig defined in {html_path}")
        changed = True
    else:
        print(f"⏩ [FIX-H] not needed in {html_path}")
    if changed:
        with open(html_path, 'w') as f:
            f.write(h)

print("\nDone.")
