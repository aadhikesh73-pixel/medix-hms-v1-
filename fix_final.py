# ================================================================
# MediX HMS — Consolidated Fix (syntax corruption + CAPTCHA wiring
# + Turnstile CSP). Safe to run more than once: every fix checks
# for its "before" pattern first, so already-fixed files are left
# alone and just print "already applied".
# Run from your project root: python3 fix_final.py
# ================================================================
import re, os, subprocess

print("=" * 60)
print("MediX HMS — Consolidated Fix")
print("=" * 60)

# ════════════════════════════════════════════════════════════
# BACKEND — backend/server.js
# ════════════════════════════════════════════════════════════
with open('backend/server.js', 'r') as f:
    s = f.read()

# ── FIX A: patch_v8's regex corruption (orphaned OPTIONS/error-handler code) ──
OLD_A = """    res.status(err.status || 500).json({ error: 'Internal server error' });
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
app.options('*', (req, res) => {"""
NEW_A = """    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Handle OPTIONS preflight — always returns 2xx or 4xx, NEVER 500
app.options('*', (req, res) => {"""
if OLD_A in s:
    s = s.replace(OLD_A, NEW_A)
    print("✅ [FIX-A1] Removed orphaned error-handler fragment (patch_v8 corruption)")
else:
    print("⏩ [FIX-A1] Not found — already fixed or file differs")

OLD_A2 = """        return res.status(403).end();
    }
});
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));"""
NEW_A2 = """        return res.status(403).end();
    }
});

// 404 handler — prevent path traversal info leakage
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));"""
if OLD_A2 in s:
    s = s.replace(OLD_A2, NEW_A2)
    print("✅ [FIX-A2] Removed orphaned closing brace before 404 handler")
else:
    print("⏩ [FIX-A2] Not found — already fixed or file differs")

# ── FIX B: patch_v9's regex corruption (orphaned CAPTCHA endpoint code) ──
OLD_B = """app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ captcha_id: id, question: c.q });
});
    res.json({ captcha_id: id, question: challenge.q });
});"""
NEW_B = """app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ captcha_id: id, question: c.q });
});"""
if OLD_B in s:
    s = s.replace(OLD_B, NEW_B)
    print("✅ [FIX-B] Removed orphaned CAPTCHA-endpoint fragment (patch_v9 corruption)")
else:
    print("⏩ [FIX-B] Not found — already fixed or file differs")

# ── FIX C: wire up CAPTCHA/Turnstile validation in the login handler ──
OLD_C = """    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);"""
NEW_C = """    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const GENERIC_AUTH_ERROR = 'Authentication failed. Please verify your credentials and try again.';

            // ── CAPTCHA / TURNSTILE VALIDATION ──────────────────────────
            const turnstileToken = req.body?.turnstile_token || '';
            const captcha_id = typeof req.body?.captcha_id === 'string' ? req.body.captcha_id : '';
            const captcha_answer = typeof req.body?.captcha_answer !== 'undefined' ? String(req.body.captcha_answer) : '';

            const turnstileResult = await verifyTurnstile(turnstileToken, req.ip);
            if (turnstileResult === true) {
                // Turnstile passed — skip word CAPTCHA check
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

            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);"""
if OLD_C in s:
    s = s.replace(OLD_C, NEW_C)
    print("✅ [FIX-C] CAPTCHA/Turnstile validation wired into /api/auth/login")
else:
    print("⏩ [FIX-C] Not found — already fixed or file differs")

# ── FIX D: root route ('/') never set its own CSP — fell back to Helmet's
#           older unsafe-inline / frame-blocking config ──
OLD_D = """    const nonce = res.locals.nonce;
    const htmlFile = authenticated ? 'index.html' : 'login.html';
    const htmlPath = path.join(__dirname, 'public', htmlFile);
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/<script(?!.*nonce)/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?!.*nonce)/g, `<style nonce="${nonce}"`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
});"""
NEW_D = """    const nonce = res.locals.nonce;
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
        `style-src 'self' 'nonce-${nonce}'; ` +
        `img-src 'self' data:; ` +
        `connect-src 'self'; ` +
        `frame-src challenges.cloudflare.com; ` +
        `frame-ancestors 'none'; ` +
        `object-src 'none'; ` +
        `base-uri 'self';`
    );
    res.send(html);
});"""
if OLD_D in s:
    s = s.replace(OLD_D, NEW_D)
    print("✅ [FIX-D] Root route ('/') now sets its own CSP (was silently using Helmet's stale one)")
else:
    print("⏩ [FIX-D] Not found — already fixed or file differs")

# ── FIX E: static-file CSP — allow Turnstile ──
OLD_E = """        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
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
NEW_E = """        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
        res.setHeader('Content-Security-Policy',
            `default-src 'self'; ` +
            `script-src 'self' 'nonce-${nonce}' cdnjs.cloudflare.com challenges.cloudflare.com; ` +
            `style-src 'self' 'nonce-${nonce}'; ` +
            `img-src 'self' data:; ` +
            `connect-src 'self'; ` +
            `frame-src challenges.cloudflare.com; ` +
            `frame-ancestors 'none'; ` +
            `object-src 'none'; ` +
            `base-uri 'self';`
        );"""
if OLD_E in s:
    s = s.replace(OLD_E, NEW_E)
    print("✅ [FIX-E] Static-file CSP now allows Turnstile")
else:
    print("⏩ [FIX-E] Not found — already fixed or file differs")

# ── FIX F: Helmet's own CSP config — allow Turnstile ──
OLD_F = """            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["'none'"],
            objectSrc:      ["'none'"],"""
NEW_F = """            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "challenges.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["challenges.cloudflare.com"],
            objectSrc:      ["'none'"],"""
if OLD_F in s:
    s = s.replace(OLD_F, NEW_F)
    print("✅ [FIX-F] Helmet CSP config now allows Turnstile (defense-in-depth)")
else:
    print("⏩ [FIX-F] Not found — already fixed or file differs")

with open('backend/server.js', 'w') as f:
    f.write(s)

r = subprocess.run(['node', '--check', 'backend/server.js'], capture_output=True, text=True)
if r.returncode == 0:
    print("✅ backend/server.js — SYNTAX OK")
else:
    print(f"❌ backend/server.js — SYNTAX ERROR:\n{r.stderr}")

# ════════════════════════════════════════════════════════════
# FRONTEND — admin/index.html and backend/public/index.html
# ════════════════════════════════════════════════════════════
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

for html_path in ['admin/index.html', 'backend/public/index.html']:
    if not os.path.exists(html_path):
        print(f"⏩ {html_path} not found — skipping")
        continue
    with open(html_path, 'r') as f:
        h = f.read()
    if OLD_G in h:
        h = h.replace(OLD_G, NEW_G)
        with open(html_path, 'w') as f:
            f.write(h)
        print(f"✅ [FIX-G] Removed orphaned genCap() fragment in {html_path}")
    else:
        print(f"⏩ [FIX-G] Not found in {html_path} — already fixed or file differs")

print("\n" + "=" * 60)
print("DONE. Review the ✅/⏩ lines above, then:")
print("  git add .")
print("  git status   # confirm it lists real changes before committing")
print("  git commit -m 'fix: patch corruption, CAPTCHA wiring, Turnstile CSP'")
print("  git push origin main")
print("=" * 60)
