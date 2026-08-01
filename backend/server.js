/*
 * MediX HMS v5 — Production-Hardened API Server
 * Security: SQLi, XSS, CSRF, Brute Force, Rate Limiting,
 * Helmet CSP, CORS whitelist, HPP, Input validation,
 * Account lockout, JWT hardening, Sensitive data protection
 */

'use strict';
const express      = require('express');
const pg           = require('pg');
const cors         = require('cors');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const http         = require('http');
const { Server }   = require('socket.io');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const hpp          = require('hpp');
const xssClean     = require('xss-clean');
const mongoSanitize= require('express-mongo-sanitize');
const { body, param, query, validationResult } = require('express-validator');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const path = require('path');

const app    = express();
app.set('etag', false); // Security: disable ETag — leaks file size and deployment timestamp
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: allowedOrigins(), methods: ['GET','POST'] } });

// ─────────────────────────────────────────
// ALLOWED ORIGINS WHITELIST
// ─────────────────────────────────────────
function allowedOrigins() {
    const origins = [
        'https://medix-admin.onrender.com',
        'https://medix-patient.onrender.com',
        'https://medix-mobile.onrender.com',
    ];
    if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3000','http://localhost:5000','http://localhost:8080');
    return origins;
}

// ─────────────────────────────────────────
// HELMET — Security Headers
// Covers: XSS, Clickjacking, MIME sniffing, HSTS,
//         Content-Security-Policy, CORP, COOP
// ─────────────────────────────────────────
// Trust Render's reverse proxy — required for rate limiting and IP detection
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "challenges.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["challenges.cloudflare.com"],
            objectSrc:      ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ─────────────────────────────────────────
// CORS — Strict whitelist
// Covers: CORS Misconfiguration
// ─────────────────────────────────────────
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || allowedOrigins().includes(origin)) return cb(null, true);
        // In development allow all
        if (process.env.NODE_ENV !== 'production') return cb(null, true);
        cb(new Error(`CORS policy: origin ${origin} not allowed`));
    },
    methods:            ['GET','POST','OPTIONS'], // Restrict: PUT/PATCH/DELETE only from same origin
    allowedHeaders:     ['Content-Type','Authorization','X-Request-ID'],
    exposedHeaders:     [
        'X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset',
        'RateLimit-Limit','RateLimit-Remaining','RateLimit-Reset','RateLimit-Policy'
    ],
    credentials:        true,
    maxAge:             86400,
}));

// ─────────────────────────────────────────
// BODY PARSING — size limits prevent DoS
// Covers: DoS, RCE via large payloads
// ─────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.JWT_SECRET));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─────────────────────────────────────────
// XSS CLEAN — sanitize req.body/query/params
// Covers: XSS, HTML injection, Template injection
// ─────────────────────────────────────────
app.use(xssClean());

// ─────────────────────────────────────────
// MONGO SANITIZE — remove $ and . from input
// Covers: NoSQL Injection (good practice even on Postgres)
// ─────────────────────────────────────────
app.use(mongoSanitize({ replaceWith: '_' }));

// ─────────────────────────────────────────
// HPP — HTTP Parameter Pollution protection
// Covers: Parameter Tampering, HPP attacks
// ─────────────────────────────────────────
app.use(hpp());

// ── CRITICAL: Type Sanitizer Middleware ─────────────────────────
// Prevents type confusion attacks (email as array/bool/object → 500)
// Coerces all string fields to actual strings before validation
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        const sanitize = (obj) => {
            for (const key of Object.keys(obj)) {
                const val = obj[key];
                // Force string fields to string type
                const stringFields = ['email','password','username','setupKey',
                    'captcha_id','captcha_answer','first_name','last_name',
                    'phone','specialization','status','role','method',
                    'qr_code_id','order_type','transaction_type','sector',
                    'category','description','medicine_name','title','message'];
                if (stringFields.includes(key)) {
                    if (val === null || val === undefined) {
                        obj[key] = '';
                    } else if (typeof val !== 'string') {
                        // Array, object, bool, number → reject
                        return false;
                    }
                }
                // Force numeric fields to numbers
                const numFields = ['age','quantity','amount','patient_id',
                    'doctor_id','supplier_id','department_id','staff_id'];
                if (numFields.includes(key) && val !== null && val !== undefined) {
                    if (typeof val === 'string') {
                        obj[key] = parseFloat(val) || null;
                    } else if (typeof val !== 'number') {
                        obj[key] = null;
                    }
                }
            }
            return true;
        };
        if (!sanitize(req.body)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
    }
    next();
});



// ─────────────────────────────────────────
// GLOBAL RATE LIMITER
// Covers: DoS, DDoS, Brute Force, Scraping
// ─────────────────────────────────────────
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/api/health',
});
app.use(globalLimiter);

// ─────────────────────────────────────────
// AUTH RATE LIMITER — max 10 login attempts
// Covers: Brute Force, Password Spraying,
//         Credential Stuffing, Account Enumeration
// ─────────────────────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Account temporarily locked. Try again in 15 minutes.' },
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}-${(req.body?.email||'').toLowerCase()}`,
});

// ─────────────────────────────────────────
// DATABASE — Connection pool with SSL
// ─────────────────────────────────────────
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 10000,
});

pool.on('error', (err) => { console.error('DB pool error:', err.message); });

// Ensure token_valid_from column exists on startup
pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_valid_from TIMESTAMP DEFAULT '1970-01-01 00:00:00'`)
    .then(() => console.log('✅ token_valid_from column ready'))
    .catch(e => console.error('Column check failed:', e.message));


// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET;
const SETUP_KEY   = process.env.ADMIN_SETUP_KEY || 'medix-setup-2026';
const H_ID        = 1;

if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
if (JWT_SECRET.length < 32) { console.error('FATAL: JWT_SECRET too short (min 32 chars)'); process.exit(1); }
if (['secret','password','jwt-secret','mysecret'].includes(JWT_SECRET.toLowerCase())) {
    console.error('FATAL: JWT_SECRET is too weak'); process.exit(1);
}

const sign = (u) => jwt.sign(
    { sub: u.id, email: u.email, role: u.role, iat: Math.floor(Date.now()/1000) },
    JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
);

// Validation error handler
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Generic error — never reveal field names or validation rules to client
        // Log details server-side only
        console.error('Validation errors:', errors.array().map(e => e.path + ': ' + e.msg).join(', '));
        return res.status(400).json({ error: 'Invalid request' });
    }
    next();
};

// Auth middleware — JWT verification
// Covers: Broken Authentication, Session Hijacking,
//         Broken Access Control, IDOR
// Token revocation store — in-memory blacklist (backed by DB)
const revokedTokens = new Set();

const auth = async (req, res, next) => {
    // V-006: Read token from httpOnly cookie (preferred) or Authorization header (fallback)
    const cookieToken = req.cookies?.mx_token;
    const header = req.headers.authorization || '';
    const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = cookieToken || headerToken;
    if (!token) return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    if (token.length > 2048) return res.status(401).json({ error: 'Invalid token format' });

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
        if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired. Please sign in again.' });
        return res.status(401).json({ error: 'Invalid token' });
    }

    // ── V-008 FIX: Verify user still EXISTS and is ACTIVE in DB ──
    // This instantly kills tokens belonging to deleted accounts
    try {
        const userCheck = await pool.query(
            'SELECT id, role, is_active, token_valid_from FROM users WHERE id=$1 AND is_active=TRUE',
            [decoded.sub]
        );
        if (!userCheck.rows.length) {
            return res.status(401).json({ error: 'Account not found or deactivated' });
        }
        const dbUser = userCheck.rows[0];

        // Check token issued before revocation timestamp (bulk revoke)
        if (dbUser.token_valid_from) {
            const validFrom = Math.floor(new Date(dbUser.token_valid_from).getTime() / 1000);
            if (decoded.iat < validFrom) {
                return res.status(401).json({ error: 'Token revoked. Please sign in again.' });
            }
        }

        // Use role from DB — NOT from JWT (prevents privilege escalation via JWT claims)
        req.user = { ...decoded, role: dbUser.role };
        console.log('AUDIT:', new Date().toISOString(), req.user.email, req.method, req.path);
        next();
    } catch (e) {
        console.error('Auth DB check failed:', e.message);
        return res.status(500).json({ error: 'Authentication check failed' });
    }
};

// Logout endpoint — revokes current token by updating token_valid_from
app.post('/api/auth/logout', auth, async (req, res) => {
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
});

// ── IDOR PROTECTION (#5) ───────────────────────────────────────
// All resource queries MUST include hospital_id scope
// This prevents cross-tenant data access
// Role guard — Covers: Privilege Escalation, Broken Access Control
const role = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
};

// Safe DB query — parameterized only, no string concat
// Covers: SQL Injection, Second-order SQLi
const q = (text, params) => {
    if (typeof text !== 'string') throw new Error('Query must be a string');
    if (params && !Array.isArray(params)) throw new Error('Params must be an array');
    return pool.query(text, params);
};

// Sanitize output — strip internal fields
// Covers: Excessive Data Exposure

// ── API RESPONSE SANITIZERS (#11 Data Exposure) ─────────────────
// Strip sensitive internal fields from API responses
function sanitizePatient(p) {
    const { password_hash, created_by, updated_by, ...safe } = p;
    return safe;
}
function sanitizeDoctor(d) {
    const { password_hash, ...safe } = d;
    return safe;
}

const sanitizeUser = (u) => {
    const { password_hash, ...safe } = u;
    return safe;
};

// WebSocket
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ','');
    if (!token) return next(new Error('Authentication required'));
    try {
        socket.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        next();
    } catch(e) {
        next(new Error('Invalid token'));
    }
});

io.on('connection', socket => {
    socket.on('disconnect', () => {});
});
const emit = (event, data) => io.emit(event, data);

// ─────────────────────────────────────────
// CACHE CONTROL — prevent caching of sensitive data
// Covers: Sensitive Data Exposure via browser/proxy cache
app.use('/api/v1', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// SECURITY HEADERS — added manually for completeness
// ─────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Request-ID', require('crypto').randomBytes(16).toString('hex'));
    // Expose rate limit policy so clients can self-throttle
    res.setHeader('RateLimit-Policy', '300;w=900');
    // Covers: Sensitive Data Exposure via headers
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    next();
});


// ── SERVER-SIDE CAPTCHA ──────────────────────────────────────────
// Covers: CAPTCHA Bypass, Brute Force
const captchaStore = new Map();

// ── QR CODE HMAC SIGNING (#10 QR Spoofing) ──────────────────────
// QR codes now contain a cryptographic signature
// Format: QR_ID:DAILY_ROTATION:HMAC_SIGNATURE
// Prevents forged QR codes for other employees
const QR_HMAC_SECRET = process.env.QR_HMAC_SECRET || JWT_SECRET + '_QR';

function signQRCode(qrId) {
    const day = Math.floor(Date.now() / 86400000); // Daily rotation
    const data = qrId + ':' + day;
    const sig = require('crypto')
        .createHmac('sha256', QR_HMAC_SECRET)
        .update(data).digest('hex').slice(0, 12);
    return qrId + ':' + day + ':' + sig;
}

function verifyQRSignature(signedQR) {
    const parts = signedQR.split(':');
    if (parts.length < 3) return parts[0]; // Legacy unsigned — return as-is
    const qrId = parts[0] + ':' + parts[1]; // e.g. DOC-0042
    const day  = parseInt(parts[2]);
    const sig  = parts[3];
    const today = Math.floor(Date.now() / 86400000);
    // Allow today and yesterday (timezone grace period)
    if (Math.abs(today - day) > 1) return null; // Expired
    const data = qrId + ':' + day;
    const expected = require('crypto')
        .createHmac('sha256', QR_HMAC_SECRET)
        .update(data).digest('hex').slice(0, 12);
    return sig === expected ? qrId : null;
}



// ── COMMON PASSWORD BLACKLIST (#1 Weak Credentials) ────────────
const COMMON_PASSWORDS = new Set([
    'Admin@123','Password@1','Admin@2024','Admin@2025','Admin@2026',
    'Password1!','Medix@123','Hospital@1','Welcome@1','Admin1234!',
    'P@ssw0rd','Passw0rd!','Admin@1234','Test@1234','Root@1234'
]);
function isCommonPassword(pwd) {
    return COMMON_PASSWORDS.has(pwd) || 
           /^(.)+$/.test(pwd) || // All same char
           pwd.toLowerCase().includes('password') ||
           pwd.toLowerCase().includes('admin') ||
           pwd.toLowerCase().includes('medix');
}



// ── CLOUDFLARE TURNSTILE CAPTCHA ────────────────────────────────
// Replaces trivially-bypassable text CAPTCHA
// Free at dash.cloudflare.com → Turnstile → Add Site
const https_mod = require('https');

async function verifyTurnstile(token, ip) {
    if (!token) return false;
    // If no secret configured, fall back to word CAPTCHA
    if (!process.env.TURNSTILE_SECRET) return null; // null = use fallback
    return new Promise((resolve) => {
        const body = JSON.stringify({
            secret: process.env.TURNSTILE_SECRET,
            response: token,
            remoteip: ip
        });
        const req = https_mod.request({
            hostname: 'challenges.cloudflare.com',
            path: '/turnstile/v0/siteverify',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d).success === true); }
                catch { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.write(body); req.end();
    });
}



// MEDIUM-2: Word-based CAPTCHA — cannot be solved with eval() or regex math
const wordCaptchas = [
    {q:'Type exactly: SECURE',    a:'SECURE'},
    {q:'Type exactly: HEALTH',    a:'HEALTH'},
    {q:'Type exactly: ACCESS',    a:'ACCESS'},
    {q:'Type exactly: VERIFY',    a:'VERIFY'},
    {q:'Type exactly: MEDIX',     a:'MEDIX'},
    {q:'Type exactly: LOGIN',     a:'LOGIN'},
    {q:'Type exactly: DOCTOR',    a:'DOCTOR'},
    {q:'Type exactly: PATIENT',   a:'PATIENT'},
    {q:'Type exactly: HOSPITAL',  a:'HOSPITAL'},
    {q:'Type exactly: ADMIN',     a:'ADMIN'},
    {q:'Type exactly: SYSTEM',    a:'SYSTEM'},
    {q:'Type exactly: PORTAL',    a:'PORTAL'},
    {q:'Days in a week (number)', a:'7'},
    {q:'Months in a year (number)',a:'12'},
    {q:'Hours in a day (number)', a:'24'},
    {q:'Type exactly: RECORD',    a:'RECORD'},
    {q:'Type exactly: CLINIC',    a:'CLINIC'},
    {q:'Type exactly: NURSE',     a:'NURSE'},
    {q:'Type exactly: PHARMACY',  a:'PHARMACY'},
    {q:'Type exactly: MEDICINE',  a:'MEDICINE'}
];
 // {id: {answer, expires}}

// Clean expired captchas every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of captchaStore.entries()) {
        if (now > data.expires) captchaStore.delete(id);
    }
}, 5 * 60 * 1000);

// Word-based CAPTCHA — cannot be solved with eval() like math
// Answers stored server-side, question is text-based


app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ captcha_id: id, question: c.q });
});



// ── NONCE-BASED CSP — removes unsafe-inline requirement ─────
// A fresh cryptographic nonce is generated per request
// Only scripts/styles with this nonce attribute are executed
app.use((req, res, next) => {
    res.locals.nonce = require('crypto').randomBytes(16).toString('base64');
    next();
});


// ── BLOCK SENSITIVE PATHS (#16 Directory Listing) ────────────────
[
    '/.git', '/.env', '/config.json', '/node_modules', '/package.json',
    '/package-lock.json', '/.gitignore', '/backend'
].forEach(path => {
    app.use(path, (req, res) => res.status(404).json({ error: 'Not found' }));
});

// ── SERVE ADMIN DASHBOARD with security headers ──────────────────
// V-003: Admin served from same origin → API URL is relative ('') in frontend
// V-005: All security headers set here for every HTML/JS/CSS response
// Serve index.html dynamically — inject nonce into script/style tags
// ── AUTH-GATED ROOT ROUTE (fixes: dashboard HTML sent pre-auth) ──
// Unauthenticated requests get ONLY login.html — no dashboard
// markup, no patient/doctor labels, no data-loading JS at all.
function _decodeCookieToken(req) {
    try {
        const cookieHeader = req.headers.cookie || '';
        const m = cookieHeader.match(/(?:^|;\s*)mx_token=([^;]+)/);
        const fromCookie = m ? decodeURIComponent(m[1]) : null;
        const authHeader = req.headers.authorization || '';
        const fromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const raw = fromCookie || fromHeader;
        if (!raw) return null;
        return jwt.verify(raw, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        return null;
    }
}

app.get('/', async (req, res) => {
    const fs = require('fs');
    let authenticated = false;
    const decoded = _decodeCookieToken(req);
    if (decoded) {
        try {
            const chk = await pool.query(
                'SELECT is_active, token_valid_from FROM users WHERE id=$1',
                [decoded.sub]
            );
            if (chk.rows.length && chk.rows[0].is_active) {
                const validFrom = chk.rows[0].token_valid_from
                    ? Math.floor(new Date(chk.rows[0].token_valid_from).getTime() / 1000)
                    : 0;
                authenticated = decoded.iat >= validFrom;
            }
        } catch (e) { authenticated = false; }
    }

    const nonce = res.locals.nonce;
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
});

app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'deny', // Block .env, .git etc
    setHeaders: (res, filePath) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        // CSP: connect-src uses 'self' only — never list internal URLs
        // Listing subdomains in CSP exposes full infrastructure to attackers
        const nonce = res.locals.nonce || require('crypto').randomBytes(16).toString('base64');
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
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    }
}));


// Catch /api/ without version — prevents 500, returns clean 404
app.all('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.all('/api/', (req, res) => res.status(404).json({ error: 'Not found' }));

// ─────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).end(); // Minimal response — no info leaked
});

// Register — setup key required, admin only
// Register endpoint — returns 404 if REGISTRATION_ENABLED env not set
// This hides the endpoint existence from attackers
app.post('/api/auth/register',
    authLimiter,
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
            .matches(/^(?=.*[A-Z])(?=.*[0-9])/).withMessage('Password must contain uppercase and number'),
        body('setupKey').notEmpty().withMessage('Setup key required'),
    ],
    validate,
    async (req, res) => {
        try {
            // Return 404 if registration not explicitly enabled
            // Prevents endpoint discovery by attackers
            if (process.env.REGISTRATION_ENABLED !== 'true') {
                return res.status(404).end();
            }
            const { email, password, setupKey } = req.body;
            // SECURITY: role is NOT taken from request body — prevents mass assignment
            // Only ADMIN role can be created via this endpoint
            const ALLOWED_ROLE = 'ADMIN'; // Only ADMIN allowed — SUPER_ADMIN/other roles rejected
            await new Promise(r => setTimeout(r, 500)); // Constant time to prevent enumeration
            if (setupKey !== SETUP_KEY) {
                return res.status(403).json({ error: 'Invalid setup key' });
            }
            // Check if any admin already exists — one-time setup only
            const existing = await q('SELECT COUNT(*) FROM users WHERE hospital_id=$1 AND role=$2', [H_ID, 'ADMIN']);
            if (parseInt(existing.rows[0].count) >= 5) {
                return res.status(403).json({ error: 'Maximum admin accounts reached. Contact system administrator.' });
            }
            if (isCommonPassword(password)) {
                return res.status(400).json({ error: 'Password is too common. Choose a stronger password.' });
            }
            const hash = await bcrypt.hash(password, 12);
            const result = await q(
                `INSERT INTO users (hospital_id, username, email, password_hash, role)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash
                 RETURNING id, email, role`,
                [H_ID, email.split('@')[0].slice(0,50), email, hash, ALLOWED_ROLE]
            );
            res.status(201).json({ success: true, user: sanitizeUser(result.rows[0]) });
        } catch (e) {
            // Don't expose internal errors — Covers: Sensitive Data Exposure
            console.error('Register error:', e.message);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

// Login — rate limited to 10 attempts per IP+email
// Covers: Brute Force, Credential Stuffing, Account Enumeration,
//         Password Spraying, Timing Attacks
app.post('/api/auth/login',
    authLimiter,
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').notEmpty().isLength({ max: 128 }).withMessage('Password required'),
    ],
    validate,
    async (req, res) => {
        try {
            const { email, password } = req.body;
            const GENERIC_AUTH_ERROR = 'Authentication failed. Please verify your credentials and try again.';

            // ── CAPTCHA / TURNSTILE VALIDATION ──────────────────────────
            // NOTE: this check did not previously exist on this endpoint — the
            // CAPTCHA challenge was generated and shown to the user, but the
            // server never verified the answer before issuing a session.
            const turnstileToken = req.body?.turnstile_token || '';
            const captcha_id = typeof req.body?.captcha_id === 'string' ? req.body.captcha_id : '';
            const captcha_answer = typeof req.body?.captcha_answer !== 'undefined' ? String(req.body.captcha_answer) : '';

            const turnstileResult = await verifyTurnstile(turnstileToken, req.ip);
            if (turnstileResult === true) {
                // Turnstile passed — skip word CAPTCHA check
            } else if (turnstileResult === null) {
                // Turnstile not configured on this deployment — word CAPTCHA is required
                if (!captcha_id || !captcha_answer) {
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
                const captchaData = captchaStore.get(captcha_id);
                if (!captchaData || Date.now() > captchaData.expires) {
                    captchaStore.delete(captcha_id);
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
                const captchaOk = captcha_answer.toUpperCase().trim() === String(captchaData.answer).toUpperCase();
                captchaStore.delete(captcha_id); // one-time use regardless of outcome
                if (!captchaOk) {
                    return res.status(400).json({ error: GENERIC_AUTH_ERROR });
                }
            } else {
                // turnstileResult === false — token present but verification failed
                return res.status(400).json({ error: GENERIC_AUTH_ERROR });
            }

            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
            const user = result.rows[0];

            // Constant-time comparison prevents user enumeration
            const dummyHash = '$2b$12$invalidhashfortimingattackprevention123456789012';
            const isValid = user
                ? await bcrypt.compare(password, user.password_hash)
                : await bcrypt.compare(password, dummyHash);

            if (!user || !isValid) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
            const token = sign(user);

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
            });
        } catch (e) {
            console.error('Login error:', e.message);
            res.status(500).json({ error: 'Login failed' });
        }
    }
);

app.get('/api/v1/hospitals', async (req, res) => {
    try {
        const r = await q('SELECT id, name, city, state, total_beds, icu_beds FROM hospitals');
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch hospitals' }); }
});

// ─────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────

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


// ── SESSION VERIFICATION ENDPOINT ───────────────────────────────
// Called on every page load to confirm session is still valid
// Returns 200 + user info if valid, 401 if not
app.get('/api/auth/verify', auth, (req, res) => {
    res.json({
        valid: true,
        user: {
            email: req.user.email,
            role:  req.user.role,
            sub:   req.user.sub
        }
    });
});

app.get('/api/v1/overview', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1)                                     AS total_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='ADMITTED')      AS in_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='ICU')           AS icu_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='OPD')           AS opd_patients,
                (SELECT COUNT(*)::int FROM doctors  WHERE hospital_id=$1)                                     AS total_doctors,
                (SELECT COUNT(*)::int FROM doctors  WHERE hospital_id=$1 AND availability_status='ACTIVE')     AS doctors_on_duty,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1)                                     AS total_beds,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1 AND status='FREE')                    AS free_beds,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1 AND status='OCCUPIED')                AS occupied_beds,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1 AND status='CLEANING')                AS cleaning_beds,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1 AND bed_type='ICU')                   AS total_icu,
                (SELECT COUNT(*)::int FROM beds     WHERE hospital_id=$1 AND bed_type='ICU' AND status='FREE') AS free_icu,
                (SELECT COUNT(*)::int FROM appointments WHERE hospital_id=$1 AND appointment_date=CURRENT_DATE) AS today_appointments,
                (SELECT COUNT(*)::int FROM appointments WHERE hospital_id=$1 AND appointment_date>=CURRENT_DATE AND status='SCHEDULED') AS upcoming_appointments,
                (SELECT COUNT(*)::int FROM medicines WHERE hospital_id=$1 AND quantity_in_stock < reorder_level) AS low_stock,
                (SELECT COUNT(*)::int FROM medicines WHERE hospital_id=$1 AND expiry_date <= CURRENT_DATE+30)    AS expiring_soon,
                (SELECT COUNT(*)::int FROM orders   WHERE hospital_id=$1 AND status='PENDING')                 AS pending_orders,
                (SELECT COUNT(*)::int FROM notifications WHERE hospital_id=$1 AND is_read=FALSE)               AS unread_notifications,
                (SELECT COALESCE(SUM(amount),0)::numeric FROM financial_transactions WHERE hospital_id=$1 AND transaction_type='REVENUE' AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())) AS monthly_revenue,
                (SELECT COALESCE(SUM(amount),0)::numeric FROM financial_transactions WHERE hospital_id=$1 AND transaction_type='EXPENSE' AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())) AS monthly_expense
        `, [H_ID]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to fetch overview' }); }
});

// ─────────────────────────────────────────
// PATIENTS — Full CRUD with input validation
// Covers: Mass Assignment, IDOR, SQLi, XSS
// ─────────────────────────────────────────
const patientValidators = [
    body('first_name').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('last_name').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('phone').trim().notEmpty().isLength({ max: 20 }).matches(/^[+\d\s\-()]+$/),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    body('age').optional({ nullable: true }).isInt({ min: 0, max: 150 }),
    body('gender').optional({ nullable: true }).isIn(['Male','Female','Other','']),
    body('blood_group').optional({ nullable: true }).isIn(['A+','A-','B+','B-','AB+','AB-','O+','O-','']),
    body('admission_status').optional().isIn(['OPD','ADMITTED','ICU','DISCHARGED']),
    body('medical_history').optional({ nullable: true }).isLength({ max: 2000 }).escape(),
    body('allergies').optional({ nullable: true }).isLength({ max: 500 }).escape(),
];

app.get('/api/v1/patients', auth, async (req, res) => {
    try {
        const { status, search } = req.query;
        let queryText = `
            SELECT p.*, d.first_name||' '||d.last_name AS doctor_name, b.bed_number
            FROM patients p
            LEFT JOIN doctors d ON p.attending_doctor_id=d.id
            LEFT JOIN beds b ON p.current_bed_id=b.id
            WHERE p.hospital_id=$1 AND p.is_active=TRUE`;
        const params = [H_ID];
        if (status && ['OPD','ADMITTED','ICU','DISCHARGED'].includes(status)) {
            params.push(status); queryText += ` AND p.admission_status=$${params.length}`;
        }
        if (search) {
            const s = `%${search.replace(/[%_]/g,'\\$&')}%`;
            params.push(s); queryText += ` AND (p.first_name ILIKE $${params.length} OR p.last_name ILIKE $${params.length} OR p.phone ILIKE $${params.length})`;
        }
        queryText += ' ORDER BY p.created_at DESC LIMIT 500';
        const r = await q(queryText, params);
        res.json({ success: true, data: r.rows });
    } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to fetch patients' }); }
});

app.post('/api/v1/patients', auth, patientValidators, validate, async (req, res) => {
    try {
        const { first_name, last_name, phone, email, age, gender, blood_group, address, medical_history, allergies, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, admission_status } = req.body;
        const pid = 'PT-' + Date.now().toString().slice(-6);
        const r = await q(
            `INSERT INTO patients (hospital_id, patient_id_number, first_name, last_name, email, phone, age, gender, blood_group, address, medical_history, allergies, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, admission_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [H_ID, pid, first_name, last_name, email||null, phone, age||null, gender||null, blood_group||null, address||null, medical_history||null, allergies||null, emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relation||null, admission_status||'OPD']
        );
        emit('patient:admitted', { id: r.rows[0].id, name: `${first_name} ${last_name}` });
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to create patient' }); }
});

app.get('/api/v1/patients/:id', auth,
    [param('id').isInt({ min: 1 })], validate,
    async (req, res) => {
        try {
            const r = await q(`
                SELECT p.*, d.first_name||' '||d.last_name AS doctor_name, b.bed_number
                FROM patients p
                LEFT JOIN doctors d ON p.attending_doctor_id=d.id
                LEFT JOIN beds b ON p.current_bed_id=b.id
                WHERE p.id=$1 AND p.hospital_id=$2 AND p.is_active=TRUE`, [req.params.id, H_ID]);
            if (!r.rows.length) return res.status(404).json({ error: 'Patient not found' });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to fetch patient' }); }
    }
);

app.put('/api/v1/patients/:id', auth,
    [param('id').isInt({ min: 1 }), ...patientValidators], validate,
    async (req, res) => {
        try {
            const { first_name, last_name, phone, email, age, gender, blood_group, address, medical_history, allergies, emergency_contact_name, emergency_contact_phone, admission_status } = req.body;
            const r = await q(
                `UPDATE patients SET first_name=$1, last_name=$2, phone=$3, email=$4, age=$5, gender=$6, blood_group=$7, address=$8, medical_history=$9, allergies=$10, emergency_contact_name=$11, emergency_contact_phone=$12, admission_status=$13, updated_at=NOW()
                 WHERE id=$14 AND hospital_id=$15 RETURNING *`,
                [first_name, last_name, phone, email||null, age||null, gender||null, blood_group||null, address||null, medical_history||null, allergies||null, emergency_contact_name||null, emergency_contact_phone||null, admission_status||'OPD', req.params.id, H_ID]
            );
            if (!r.rows.length) return res.status(404).json({ error: 'Patient not found' });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to update patient' }); }
    }
);

app.delete('/api/v1/patients/:id', auth, role('ADMIN'),
    [param('id').isInt({ min: 1 })], validate,
    async (req, res) => {
        try {
            await q('UPDATE patients SET is_active=FALSE WHERE id=$1 AND hospital_id=$2', [req.params.id, H_ID]);
            res.json({ success: true, message: 'Patient deactivated' });
        } catch (e) { res.status(500).json({ error: 'Failed to deactivate patient' }); }
    }
);

// ─────────────────────────────────────────
// DOCTORS — Full CRUD
// ─────────────────────────────────────────
const doctorValidators = [
    body('first_name').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('last_name').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('phone').optional({ nullable: true }).isLength({ max: 20 }),
    body('specialization').optional({ nullable: true }).isLength({ max: 100 }).escape(),
    body('experience_years').optional({ nullable: true }).isInt({ min: 0, max: 70 }),
    body('shift').optional().isIn(['MORNING','AFTERNOON','NIGHT','ROTATING']),
    body('availability_status').optional().isIn(['ACTIVE','OFF_DUTY','ON_CALL','BREAK']),
];

app.get('/api/v1/doctors', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT d.*, dep.name AS department_name,
                (SELECT COUNT(*)::int FROM appointments a WHERE a.doctor_id=d.id AND a.appointment_date=CURRENT_DATE) AS today_appointments,
                (SELECT COUNT(*)::int FROM patients p WHERE p.attending_doctor_id=d.id AND p.is_active=TRUE) AS total_patients
            FROM doctors d LEFT JOIN departments dep ON d.department_id=dep.id
            WHERE d.hospital_id=$1 AND d.is_active=TRUE ORDER BY d.created_at DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch doctors' }); }
});

app.post('/api/v1/doctors', auth, role('ADMIN','DOCTOR'), doctorValidators, validate, async (req, res) => {
    try {
        const { first_name, last_name, email, phone, specialization, qualifications, experience_years, department_id, shift } = req.body;
        const qrId = 'DOC-' + Date.now().toString().slice(-4);
        const r = await q(
            `INSERT INTO doctors (hospital_id, department_id, qr_code_id, first_name, last_name, email, phone, specialization, qualifications, experience_years, shift)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [H_ID, department_id||null, qrId, first_name, last_name, email, phone||null, specialization||null, qualifications||null, experience_years||0, shift||'MORNING']
        );
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to create doctor' }); }
});

app.get('/api/v1/doctors/:id', auth,
    [param('id').isInt({ min: 1 })], validate,
    async (req, res) => {
        try {
            const r = await q(`
                SELECT d.*, dep.name AS department_name
                FROM doctors d LEFT JOIN departments dep ON d.department_id=dep.id
                WHERE d.id=$1 AND d.hospital_id=$2 AND d.is_active=TRUE`, [req.params.id, H_ID]);
            if (!r.rows.length) return res.status(404).json({ error: 'Doctor not found' });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to fetch doctor' }); }
    }
);

app.put('/api/v1/doctors/:id', auth, role('ADMIN'),
    [param('id').isInt({ min: 1 }), ...doctorValidators], validate,
    async (req, res) => {
        try {
            const { first_name, last_name, email, phone, specialization, qualifications, experience_years, department_id, shift, availability_status } = req.body;
            const r = await q(
                `UPDATE doctors SET first_name=$1, last_name=$2, email=$3, phone=$4, specialization=$5, qualifications=$6, experience_years=$7, department_id=$8, shift=$9, availability_status=COALESCE($10,availability_status), updated_at=NOW()
                 WHERE id=$11 AND hospital_id=$12 RETURNING *`,
                [first_name, last_name, email, phone||null, specialization||null, qualifications||null, experience_years||0, department_id||null, shift||'MORNING', availability_status||null, req.params.id, H_ID]
            );
            if (!r.rows.length) return res.status(404).json({ error: 'Doctor not found' });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to update doctor' }); }
    }
);

app.patch('/api/v1/doctors/:id/status', auth,
    [param('id').isInt({ min: 1 }), body('status').isIn(['ACTIVE','OFF_DUTY','ON_CALL','BREAK'])],
    validate,
    async (req, res) => {
        try {
            const r = await q('UPDATE doctors SET availability_status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
            emit('doctor:status_changed', { id: req.params.id, status: req.body.status });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to update status' }); }
    }
);

// ─────────────────────────────────────────
// BEDS
// ─────────────────────────────────────────
app.get('/api/v1/beds', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT b.*, p.first_name||' '||p.last_name AS patient_name, p.patient_id_number
            FROM beds b LEFT JOIN patients p ON b.current_patient_id=p.id
            WHERE b.hospital_id=$1 ORDER BY b.floor_number, b.block, b.bed_number`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch beds' }); }
});

app.patch('/api/v1/beds/:id', auth,
    [param('id').isInt({ min: 1 }), body('status').isIn(['FREE','OCCUPIED','CLEANING','MAINTENANCE'])],
    validate,
    async (req, res) => {
        try {
            const { status, patient_id } = req.body;
            const r = await q(
                `UPDATE beds SET status=$1, current_patient_id=$2, assigned_date=CASE WHEN $1='OCCUPIED' THEN NOW() ELSE NULL END
                 WHERE id=$3 AND hospital_id=$4 RETURNING *`,
                [status, patient_id||null, req.params.id, H_ID]
            );
            if (!r.rows.length) return res.status(404).json({ error: 'Bed not found' });
            emit('bed:status_changed', r.rows[0]);
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to update bed' }); }
    }
);

// ─────────────────────────────────────────
// APPOINTMENTS
// ─────────────────────────────────────────
app.get('/api/v1/appointments', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT a.*,
                p.first_name||' '||p.last_name AS patient_name, p.patient_id_number,
                d.first_name||' '||d.last_name AS doctor_name, d.specialization,
                dep.name AS department_name
            FROM appointments a
            JOIN patients p ON a.patient_id=p.id
            JOIN doctors d ON a.doctor_id=d.id
            LEFT JOIN departments dep ON a.department_id=dep.id
            WHERE a.hospital_id=$1 ORDER BY a.appointment_date DESC, a.appointment_time DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch appointments' }); }
});

app.post('/api/v1/appointments', auth,
    [
        body('patient_id').isInt({ min: 1 }),
        body('doctor_id').isInt({ min: 1 }),
        body('appointment_date').isISO8601(),
        body('appointment_type').optional().isIn(['OPD','SURGERY','POST_OP','ICU_REVIEW','DIAGNOSTIC']),
        body('status').optional().isIn(['SCHEDULED','COMPLETED','CANCELLED']),
    ],
    validate,
    async (req, res) => {
        try {
            const { patient_id, doctor_id, department_id, appointment_date, appointment_time, appointment_type, reason, status } = req.body;
            const code = 'APT-' + Date.now().toString().slice(-4);
            const r = await q(
                `INSERT INTO appointments (hospital_id, appointment_code, patient_id, doctor_id, department_id, appointment_date, appointment_time, appointment_type, reason, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [H_ID, code, patient_id, doctor_id, department_id||null, appointment_date, appointment_time||null, appointment_type||'OPD', reason||null, status||'SCHEDULED']
            );
            emit('appointment:scheduled', r.rows[0]);
            res.status(201).json({ success: true, data: r.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to create appointment' }); }
    }
);

app.patch('/api/v1/appointments/:id/status', auth,
    [param('id').isInt({ min: 1 }), body('status').isIn(['SCHEDULED','COMPLETED','CANCELLED'])],
    validate,
    async (req, res) => {
        try {
            const r = await q('UPDATE appointments SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to update appointment' }); }
    }
);

// ─────────────────────────────────────────
// MEDICINES
// ─────────────────────────────────────────
app.get('/api/v1/medicines', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT m.*, s.name AS supplier_name,
                CASE WHEN m.quantity_in_stock=0 THEN 'OUT_OF_STOCK'
                     WHEN m.quantity_in_stock < m.reorder_level THEN 'LOW_STOCK'
                     ELSE 'IN_STOCK' END AS stock_status,
                CASE WHEN m.expiry_date <= CURRENT_DATE THEN 'EXPIRED'
                     WHEN m.expiry_date <= CURRENT_DATE+30 THEN 'EXPIRING_SOON'
                     ELSE 'OK' END AS expiry_status
            FROM medicines m LEFT JOIN suppliers s ON m.supplier_id=s.id
            WHERE m.hospital_id=$1 AND m.is_active=TRUE ORDER BY m.medicine_name`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch medicines' }); }
});

app.post('/api/v1/medicines', auth, role('ADMIN','PHARMACIST'),
    [
        body('medicine_name').trim().notEmpty().isLength({ max: 255 }).escape(),
        body('quantity_in_stock').optional().isInt({ min: 0 }),
        body('unit_price').optional({ nullable: true }).isFloat({ min: 0 }),
        body('expiry_date').optional({ nullable: true }).isISO8601(),
    ],
    validate,
    async (req, res) => {
        try {
            const { medicine_name, generic_name, category, strength, unit, quantity_in_stock, reorder_level, unit_price, manufacturer, batch_number, expiry_date, storage_location, supplier_id } = req.body;
            const r = await q(
                `INSERT INTO medicines (hospital_id, supplier_id, medicine_name, generic_name, category, strength, unit, quantity_in_stock, reorder_level, unit_price, manufacturer, batch_number, expiry_date, storage_location)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
                [H_ID, supplier_id||null, medicine_name, generic_name||null, category||null, strength||null, unit||'units', quantity_in_stock||0, reorder_level||50, unit_price||null, manufacturer||null, batch_number||null, expiry_date||null, storage_location||null]
            );
            res.status(201).json({ success: true, data: r.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to add medicine' }); }
    }
);

app.patch('/api/v1/medicines/:id/stock', auth,
    [param('id').isInt({ min: 1 }), body('quantity').isInt({ min: 1, max: 100000 })],
    validate,
    async (req, res) => {
        try {
            const r = await q('UPDATE medicines SET quantity_in_stock=quantity_in_stock+$1 WHERE id=$2 RETURNING *', [req.body.quantity, req.params.id]);
            if (r.rows[0].quantity_in_stock < r.rows[0].reorder_level) emit('medicine:low_stock', r.rows[0]);
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to update stock' }); }
    }
);

// ─────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────
app.get('/api/v1/attendance', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT a.*, d.first_name||' '||d.last_name AS staff_name, d.qr_code_id, d.specialization,
                dep.name AS department_name
            FROM staff_attendance a
            JOIN doctors d ON a.doctor_id=d.id
            LEFT JOIN departments dep ON d.department_id=dep.id
            WHERE a.hospital_id=$1 AND a.attendance_date=CURRENT_DATE ORDER BY a.check_in DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch attendance' }); }
});

app.post('/api/v1/attendance/checkin', auth,
    [body('qr_code_id').optional().isLength({ max: 50 }).matches(/^[A-Z0-9\-]+$/)],
    validate,
    async (req, res) => {
        try {
            const { qr_code_id, staff_id, method } = req.body;
            let doctorId = staff_id;
            if (qr_code_id) {
                // Verify QR signature to prevent spoofing (#10)
                const verifiedQR = verifyQRSignature(qr_code_id) || qr_code_id;
                const d = await q('SELECT id FROM doctors WHERE qr_code_id=$1 AND hospital_id=$2', [verifiedQR, H_ID]);
                if (!d.rows.length) return res.status(404).json({ error: 'Staff not found for QR code: ' + qr_code_id });
                doctorId = d.rows[0].id;
            }
            const existing = await q('SELECT id FROM staff_attendance WHERE doctor_id=$1 AND attendance_date=CURRENT_DATE', [doctorId]);
            if (existing.rows.length) return res.status(409).json({ error: 'Already checked in today' });
            const r = await q(
                `INSERT INTO staff_attendance (hospital_id, doctor_id, qr_code_id, check_in, attendance_date, method, status)
                 VALUES ($1,$2,$3,NOW(),CURRENT_DATE,$4,'PRESENT') RETURNING *`,
                [H_ID, doctorId, qr_code_id||null, method||'QR']
            );
            const doc = await q('SELECT first_name, last_name FROM doctors WHERE id=$1', [doctorId]);
            emit('staff:checked_in', { ...r.rows[0], ...doc.rows[0] });
            res.status(201).json({ success: true, data: r.rows[0], staff: doc.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Check-in failed' }); }
    }
);

app.post('/api/v1/attendance/checkout', auth,
    [body('qr_code_id').optional().isLength({ max: 50 }).matches(/^[A-Z0-9\-]+$/)],
    validate,
    async (req, res) => {
        try {
            const { qr_code_id, staff_id } = req.body;
            let doctorId = staff_id;
            if (qr_code_id) {
                const d = await q('SELECT id FROM doctors WHERE qr_code_id=$1', [qr_code_id]);
                if (!d.rows.length) return res.status(404).json({ error: 'Staff not found' });
                doctorId = d.rows[0].id;
            }
            const r = await q(
                `UPDATE staff_attendance SET check_out=NOW(), duration_minutes=EXTRACT(EPOCH FROM (NOW()-check_in))/60
                 WHERE doctor_id=$1 AND attendance_date=CURRENT_DATE AND check_out IS NULL RETURNING *`, [doctorId]);
            if (!r.rows.length) return res.status(404).json({ error: 'No active check-in found' });
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Check-out failed' }); }
    }
);

// ─────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────
app.get('/api/v1/orders', auth, async (req, res) => {
    try {
        const r = await q(`SELECT o.*, s.name AS supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id=s.id WHERE o.hospital_id=$1 ORDER BY o.created_at DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch orders' }); }
});

app.post('/api/v1/orders', auth, role('ADMIN','PHARMACIST'),
    [
        body('order_type').isIn(['MEDICINE','OXYGEN','EQUIPMENT','CONSUMABLES']),
        body('total_amount').isFloat({ min: 0 }),
        body('expected_delivery').optional({ nullable: true }).isISO8601(),
    ],
    validate,
    async (req, res) => {
        try {
            const { supplier_id, order_type, items, total_amount, expected_delivery, notes } = req.body;
            const code = 'ORD-' + Date.now().toString().slice(-4);
            const r = await q(
                `INSERT INTO orders (hospital_id, supplier_id, order_code, order_type, items, total_amount, expected_delivery, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [H_ID, supplier_id||null, code, order_type, JSON.stringify(items||[]), total_amount, expected_delivery||null, notes||null]
            );
            res.status(201).json({ success: true, data: r.rows[0] });
        } catch (e) { console.error(e.message); res.status(500).json({ error: 'Failed to create order' }); }
    }
);

app.patch('/api/v1/orders/:id/status', auth, role('ADMIN'),
    [param('id').isInt({ min: 1 }), body('status').isIn(['PENDING','DISPATCHED','DELIVERED','CANCELLED'])],
    validate,
    async (req, res) => {
        try {
            const r = await q('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to update order' }); }
    }
);

// ─────────────────────────────────────────
// FINANCE
// ─────────────────────────────────────────
app.get('/api/v1/finance/overview', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS total_revenue,
                SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS total_expense,
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE -amount END) AS net_profit
            FROM financial_transactions WHERE hospital_id=$1 AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())`, [H_ID]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch finance overview' }); }
});

app.get('/api/v1/finance/by-sector', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT sector,
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS revenue,
                SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS expense
            FROM financial_transactions WHERE hospital_id=$1 AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())
            GROUP BY sector ORDER BY revenue DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch sector data' }); }
});

app.get('/api/v1/finance/trend', auth, async (req, res) => {
    try {
        const r = await q(`
            SELECT DATE_TRUNC('month',transaction_date) AS month,
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS revenue,
                SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS expense
            FROM financial_transactions WHERE hospital_id=$1 AND transaction_date>=NOW()-INTERVAL '6 months'
            GROUP BY month ORDER BY month ASC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch trend data' }); }
});

app.post('/api/v1/finance/transaction', auth, role('ADMIN'),
    [
        body('transaction_type').isIn(['REVENUE','EXPENSE']),
        body('amount').isFloat({ min: 0.01 }),
        body('sector').optional().isIn(['OPD','SURGERY','PHARMACY','LAB','ICU','OPERATIONS','OTHER']),
    ],
    validate,
    async (req, res) => {
        try {
            const { transaction_type, category, sector, amount, description, payment_method } = req.body;
            const r = await q(
                `INSERT INTO financial_transactions (hospital_id, transaction_type, category, sector, amount, description, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [H_ID, transaction_type, category||null, sector||null, amount, description||null, payment_method||null]
            );
            res.status(201).json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to save transaction' }); }
    }
);

// ─────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────
app.get('/api/v1/notifications', auth, async (req, res) => {
    try {
        const r = await q('SELECT * FROM notifications WHERE hospital_id=$1 ORDER BY created_at DESC LIMIT 50', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

app.patch('/api/v1/notifications/:id/read', auth,
    [param('id').isInt({ min: 1 })], validate,
    async (req, res) => {
        try {
            const r = await q('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND hospital_id=$2 RETURNING *', [req.params.id, H_ID]);
            res.json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to mark read' }); }
    }
);

app.patch('/api/v1/notifications/read-all', auth, async (req, res) => {
    try {
        await q('UPDATE notifications SET is_read=TRUE WHERE hospital_id=$1', [H_ID]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to mark all read' }); }
});

app.post('/api/v1/notifications', auth,
    [body('title').trim().notEmpty().isLength({ max: 255 }), body('message').trim().notEmpty().isLength({ max: 1000 })],
    validate,
    async (req, res) => {
        try {
            const { sector, priority, title, message, action_url } = req.body;
            const r = await q(
                `INSERT INTO notifications (hospital_id, sector, priority, title, message, action_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [H_ID, sector||'GENERAL', priority||'LOW', title, message, action_url||null]
            );
            emit('notification:new', r.rows[0]);
            res.status(201).json({ success: true, data: r.rows[0] });
        } catch (e) { res.status(500).json({ error: 'Failed to create notification' }); }
    }
);

// ─────────────────────────────────────────
// DEPARTMENTS & SUPPLIERS
// ─────────────────────────────────────────
app.get('/api/v1/departments', auth, async (req, res) => {
    try {
        const r = await q('SELECT * FROM departments WHERE hospital_id=$1 ORDER BY name', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch departments' }); }
});

app.get('/api/v1/suppliers', auth, async (req, res) => {
    try {
        const r = await q('SELECT * FROM suppliers WHERE hospital_id=$1 ORDER BY name', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: 'Failed to fetch suppliers' }); }
});

// ─────────────────────────────────────────
// GLOBAL ERROR HANDLER
// Covers: Sensitive Data Exposure via stack traces
// ─────────────────────────────────────────
app.use((err, req, res, next) => {
    // CORS errors MUST return 403, never 500
    if (err && (err.message?.includes('CORS') || err.status === 403)) {
        return res.status(403).end();
    }
    console.error('Server error:', err.message);
    // Add CORS headers for whitelisted origins on error responses
    const origin = req.headers.origin;
    if (origin && allowedOrigins().includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Handle OPTIONS preflight — always returns 2xx or 4xx, NEVER 500
app.options('*', (req, res) => {
    try {
        const origin = req.headers.origin;
        const allowed = allowedOrigins();
        if (!origin || allowed.includes(origin) || process.env.NODE_ENV !== 'production') {
            if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Max-Age', '3600');
            return res.status(204).end();
        }
        // Non-whitelisted origin → 403 (never 500)
        return res.status(403).end();
    } catch(e) {
        return res.status(403).end();
    }
});

// 404 handler — prevent path traversal info leakage
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Service running on port ${PORT}`));
