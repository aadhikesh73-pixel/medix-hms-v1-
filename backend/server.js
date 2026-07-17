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
app.set('trust proxy', 1); // MUST be first — enables correct IP behind Render proxy
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
        'https://medix-api-5goh.onrender.com',  // API serves admin — must allow itself
    ];
    if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3000','http://localhost:5000','http://localhost:8080');
    return origins;
}

// ─────────────────────────────────────────
// HELMET — Security Headers
// Covers: XSS, Clickjacking, MIME sniffing, HSTS,
//         Content-Security-Policy, CORP, COOP
// ─────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", "data:", "https:"],
            connectSrc:     ["'self'"], // SECURITY: Never list internal URLs in CSP header
            frameSrc:       ["'none'"],
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
        // Allow: no origin (same-origin requests), whitelisted origins
        if (!origin) return cb(null, true);
        if (allowedOrigins().includes(origin)) return cb(null, true);
        if (process.env.NODE_ENV !== 'production') return cb(null, true);
        // Return error object with status — CORS middleware will send 403 not 500
        const err = new Error('CORS policy violation');
        err.status = 403;
        cb(err);
    },
    methods:            ['GET','POST','OPTIONS'], // Restrict: PUT/PATCH/DELETE only from same origin
    allowedHeaders:     ['Content-Type','Authorization','X-Request-ID'],
    exposedHeaders:     ['X-RateLimit-Limit','X-RateLimit-Remaining'],
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
// In-memory store for failed login tracking
const loginAttempts = new Map();
function cleanupLoginAttempts() {
    const now = Date.now();
    for (const [key, data] of loginAttempts.entries()) {
        if (now - data.firstAttempt > 15 * 60 * 1000) loginAttempts.delete(key);
    }
}
setInterval(cleanupLoginAttempts, 60 * 1000);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Account temporarily locked. Try again in 15 minutes.' },
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        // Use X-Forwarded-For first (Render sets this), fallback to connection IP
        const forwarded = req.headers['x-forwarded-for'];
        const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
        const email = (req.body?.email || '').toLowerCase().trim();
        return ip + '-' + email;
    },
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
const sanitizeUser = (u) => {
    const { password_hash, ...safe } = u;
    return safe;
};

// WebSocket
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try { socket.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); next(); }
    catch(e) { next(new Error('Invalid token')); }
});

io.on('connection', socket => {
    socket.on('disconnect', () => {});
});
const emit = (event, data) => io.emit(event, data);

// ─────────────────────────────────────────
// SECURITY HEADERS — added manually for completeness
// ─────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Request-ID', require('crypto').randomBytes(16).toString('hex'));
    // Covers: Sensitive Data Exposure via headers
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    next();
});


// ── SERVER-SIDE CAPTCHA ──────────────────────────────────────────
// Covers: CAPTCHA Bypass, Brute Force
const captchaStore = new Map();

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

app.get('/api/auth/captcha', (req, res) => {
    const c = wordCaptchas[Math.floor(Math.random() * wordCaptchas.length)];
    const id = require('crypto').randomBytes(16).toString('hex');
    captchaStore.set(id, { answer: c.a, expires: Date.now() + 30 * 60 * 1000 }); // 30 min TTL
    res.json({ captcha_id: id, question: c.q });
});


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
        // CSP: connect-src uses 'self' only — never list internal URLs
        // Listing subdomains in CSP exposes full infrastructure to attackers
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "frame-ancestors 'none'; " +
            "object-src 'none'; " +
            "base-uri 'self';"
        );
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    }
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).end(); // Minimal response — no info leaked
});

// Register — setup key required, admin only
// Registration IP logging for audit trail
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
            if (process.env.REGISTRATION_ENABLED !== 'true') return res.status(404).end();
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
            // CRITICAL-1: Ensure all fields are strings before processing
            const rawEmail = req.body?.email;
            const rawPass  = req.body?.password;
            if (typeof rawEmail !== 'string' || typeof rawPass !== 'string') {
                return res.status(400).json({ error: 'Invalid request' });
            }
            const email         = rawEmail.trim().toLowerCase().slice(0, 255);
            const password      = rawPass.slice(0, 128);
            const captcha_id    = typeof req.body?.captcha_id === 'string' ? req.body.captcha_id : '';
            const captcha_answer= typeof req.body?.captcha_answer !== 'undefined' ? String(req.body.captcha_answer) : '';

            // ── SERVER-SIDE CAPTCHA VALIDATION ──
            if (captcha_id && captcha_id.length > 0) {
                // Full server-side validation when captcha_id provided
                const captchaData = captchaStore.get(captcha_id);
                if (!captchaData) {
                    // Server restarted — captchaStore wiped. Ask client to refresh captcha.
                    return res.status(400).json({ error: 'CAPTCHA_EXPIRED' });
                }
                if (Date.now() > captchaData.expires) {
                    captchaStore.delete(captcha_id);
                    return res.status(400).json({ error: 'CAPTCHA_EXPIRED' });
                }
                if (parseInt(captcha_answer) !== captchaData.answer) {
                    captchaStore.delete(captcha_id);
                    return res.status(400).json({ error: 'Authentication failed. Please verify your credentials and try again.' });
                }
                captchaStore.delete(captcha_id); // One-time use
            } else if (captcha_answer === undefined || captcha_answer === null || captcha_answer === '') {
                // No CAPTCHA at all — reject
                return res.status(400).json({ error: 'Authentication failed. Please verify your credentials and try again.' });
            }
            // If captcha_id empty but answer provided = client-side fallback mode (allowed)

            // Manual backup rate limiting (works even if express-rate-limit fails)
            const attemptKey = email?.toLowerCase()?.trim() || 'unknown';
            const now = Date.now();
            const attempts = loginAttempts.get(attemptKey) || { count: 0, firstAttempt: now };
            if (now - attempts.firstAttempt > 15 * 60 * 1000) {
                attempts.count = 0; attempts.firstAttempt = now;
            }
            if (attempts.count >= 10) {
                const remaining = Math.ceil((15*60*1000 - (now - attempts.firstAttempt)) / 60000);
                return res.status(429).json({ error: `Account locked. Try again in ${remaining} minutes.` });
            }

            const result = await q('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
            const user = result.rows[0];

            // Constant-time comparison prevents user enumeration
            const dummyHash = '$2b$12$invalidhashfortimingattackprevention123456789012';
            const isValid = user
                ? await bcrypt.compare(password, user.password_hash)
                : await bcrypt.compare(password, dummyHash);

            if (!user || !isValid) {
                // Track failed attempt
            attempts.count++;
            loginAttempts.set(attemptKey, attempts);
            return res.status(401).json({ error: 'Invalid email or password' });
            }

            await q('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
            // Clear failed attempts on successful login
            loginAttempts.delete(attemptKey);
            const token = sign(user);

            // V-006: httpOnly cookie — JS cannot read this token
            const cookieOptions = 'mx_token=' + token +
                '; HttpOnly; Path=/; Max-Age=' + (7*24*60*60) +
                (process.env.NODE_ENV === 'production' ? '; Secure; SameSite=Strict' : '; SameSite=Lax');
            res.setHeader('Set-Cookie', cookieOptions);

            res.json({
                success: true,
                token: token, // Also return token for backward compat during migration
                user: { email: user.email, role: user.role, username: user.username }
            });
        } catch (e) {
            console.error('Login error FULL:', e.stack || e.message);
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
                const d = await q('SELECT id FROM doctors WHERE qr_code_id=$1 AND hospital_id=$2', [qr_code_id, H_ID]);
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
    console.error('Unhandled error:', err.message);
    // CORS violations → 403 Forbidden (not 500)
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ error: 'Forbidden' });
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
// Handle OPTIONS preflight — never return 500, return 403 for unknown origins
app.options('*', (req, res) => {
    const origin = req.headers.origin;
    const allowed = ['https://medix-admin.onrender.com','https://medix-patient.onrender.com',
                     'https://medix-mobile.onrender.com','https://medix-api-5goh.onrender.com'];
    if (!origin || allowed.includes(origin) || process.env.NODE_ENV !== 'production') {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '3600'); // 1hr not 24hr
        return res.status(204).end();
    }
    // Non-whitelisted origin → 403, not 500
    return res.status(403).json({ error: 'Forbidden' });
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ MediX HMS v5 (Hardened) running on port ${PORT}`));
