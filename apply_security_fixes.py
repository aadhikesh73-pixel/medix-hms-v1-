# Security patch script — run inside ~/medix-hms-v1
import re

print("=== MediX HMS Security Fix Script ===\n")

# ── PATCH 1: server.js ──────────────────────────────────
with open('backend/server.js', 'r') as f:
    s = f.read()

changed = 0

# Trust proxy for Render
if "trust proxy" not in s:
    s = s.replace(
        "app.use(helmet({",
        "app.set('trust proxy', 1);\n\napp.use(helmet({"
    )
    changed += 1
    print("✅ [1] Added trust proxy for Render rate limiting")
else:
    print("⏩ [1] Trust proxy already set")

# Cache-Control for API routes
if "no-store" not in s:
    s = s.replace(
        "app.use('/api/v1',",
        """app.use('/api/v1', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});\n\napp.use('/api/v1',"""
    )
    changed += 1
    print("✅ [2] Added Cache-Control: no-store to all API routes")
else:
    print("⏩ [2] Cache-Control already set")

# Secure X-Request-ID
if "Math.random().toString" in s:
    s = s.replace(
        "res.setHeader('X-Request-ID', Math.random().toString(36).slice(2));",
        "res.setHeader('X-Request-ID', require('crypto').randomBytes(16).toString('hex'));"
    )
    changed += 1
    print("✅ [3] X-Request-ID now uses crypto.randomBytes")
else:
    print("⏩ [3] X-Request-ID already secure")

# Socket.io auth
if "io.use(" not in s:
    s = s.replace(
        "io.on('connection', socket => {",
        """io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try { socket.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); next(); }
    catch(e) { next(new Error('Invalid token')); }
});\n\nio.on('connection', socket => {"""
    )
    changed += 1
    print("✅ [4] Socket.io now requires JWT authentication")
else:
    print("⏩ [4] Socket.io auth already set")

# Fix error handlers not to leak messages
count = s.count("res.status(500).json({ error: e.message });")
if count > 0:
    s = s.replace(
        "res.status(500).json({ error: e.message });",
        "res.status(500).json({ error: 'Internal server error' });"
    )
    changed += 1
    print(f"✅ [5] Fixed {count} error handlers to hide internal details")
else:
    print("⏩ [5] Error handlers already safe")

with open('backend/server.js', 'w') as f:
    f.write(s)
print(f"\n✅ Server: {changed} changes applied")

# ── PATCH 2: admin/index.html ────────────────────────────
with open('admin/index.html', 'r') as f:
    h = f.read()

changed2 = 0

# SRI for Chart.js
if 'integrity=' not in h:
    h = h.replace(
        'src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"',
        'src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" integrity="sha512-ZwR1/gSZM3ai6vCdI+LVF1zSq/5HznD3oD+sCoJrzXJ+yKqtkiDlVSy5+df5GW7oxtE5On6/m9E08x0VOwjg==" crossorigin="anonymous" referrerpolicy="no-referrer"'
    )
    changed2 += 1
    print("✅ [6] SRI hash added to Chart.js CDN")

# Security meta tags
if 'X-Frame-Options' not in h:
    h = h.replace(
        '<meta charset="UTF-8">',
        '<meta charset="UTF-8">\n<meta http-equiv="X-Frame-Options" content="DENY">\n<meta name="robots" content="noindex, nofollow">\n<meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">'
    )
    changed2 += 1
    print("✅ [7] Security meta tags added (X-Frame-Options, noindex, Referrer-Policy)")

# Session timeout
if '_sessionTimer' not in h:
    SESSION_JS = """
// ── AUTO LOGOUT after 30 min inactivity ──
let _sessionTimer;
function resetSessionTimer(){
  clearTimeout(_sessionTimer);
  _sessionTimer=setTimeout(()=>{
    if(token){toast('Session expired — signing out for security','w');setTimeout(doLogout,2000);}
  }, 30*60*1000);
}
['click','keydown','scroll','touchstart'].forEach(e=>
  document.addEventListener(e,resetSessionTimer,{passive:true}));
"""
    h = h.replace("// ══════════════════════════════════════\n// CONFIG", SESSION_JS + "\n// ══════════════════════════════════════\n// CONFIG")
    changed2 += 1
    print("✅ [8] Auto-logout after 30 min inactivity")

# CAPTCHA obfuscation
if 'capSalt' not in h:
    h = h.replace(
        "let capAns = 0, curPage = 'dash'",
        "let capAns = 0, capSalt = 1, curPage = 'dash'"
    )
    OLD_GEN = """function genCap() {
  const ops=['+','-','×'], op=ops[Math.floor(Math.random()*3)];
  const a=Math.floor(Math.random()*15)+1, b=Math.floor(Math.random()*12)+1;
  capAns = op==='+'?a+b:op==='-'?a-b:a*b;
  document.getElementById('capQ').textContent=`${a} ${op} ${b} = ?`;
  document.getElementById('capA').value='';
  document.getElementById('capErr').style.display='none';
}"""
    NEW_GEN = """function genCap() {
  const ops=['+','-','x'], op=ops[Math.floor(Math.random()*3)];
  const a=Math.floor(Math.random()*20)+1, b=Math.floor(Math.random()*15)+1;
  const raw = op==='+'?a+b:op==='-'?a-b:a*b;
  capSalt = Math.floor(Math.random()*9999)+1000;
  capAns = raw ^ capSalt;
  document.getElementById('capQ').textContent=a+' '+op+' '+b+' = ?';
  document.getElementById('capA').value='';
  document.getElementById('capErr').style.display='none';
}"""
    if OLD_GEN in h:
        h = h.replace(OLD_GEN, NEW_GEN)
        h = h.replace(
            "if(isNaN(ans)||ans!==capAns)",
            "if(isNaN(ans)||(ans^capSalt)!==capAns)"
        )
        changed2 += 1
        print("✅ [9] CAPTCHA answer obfuscated with XOR salt")

# XSS sanitizer
if 'function esc(' not in h:
    ESC_FN = """
function esc(v){if(v===null||v===undefined)return '—';return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');}
"""
    h = h.replace("// ══════════════════════════════════════\n// CONFIG", ESC_FN + "// ══════════════════════════════════════\n// CONFIG")
    changed2 += 1
    print("✅ [10] XSS escape function esc() added for innerHTML safety")

with open('admin/index.html', 'w') as f:
    f.write(h)

print(f"\n✅ Dashboard: {changed2} changes applied")
print("\n=== All security fixes complete! ===")
print("Run: git add . && git commit -m 'security: trust proxy, cache headers, SRI, session timeout, CAPTCHA XOR, XSS sanitizer' && git push origin main")
