const express = require('express');
const pg = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'medix-dev-secret-change-me';
const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'medix-setup-2026';
const HOSPITAL_ID = 1;

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

function signToken(user) {
    return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (err) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

// PUBLIC
app.get('/api/health', (req, res) => res.json({ status: 'MediX HMS running', time: new Date() }));

app.get('/api/v1/hospitals', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hospitals');
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, role, setupKey } = req.body;
        if (setupKey !== ADMIN_SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        const passwordHash = await bcrypt.hash(password, 10);
        const username = email.split('@')[0];
        const result = await pool.query(
            `INSERT INTO users (hospital_id, username, email, password_hash, role)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
             RETURNING id, email, role`,
            [HOSPITAL_ID, username, email, passwordHash, role || 'ADMIN']
        );
        res.status(201).json({ success: true, user: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
        const token = signToken(user);
        res.json({ success: true, token, user: { email: user.email, role: user.role, username: user.username } });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// OVERVIEW
app.get('/api/v1/overview', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM patients)::int AS total_patients,
                (SELECT COUNT(*) FROM doctors)::int AS total_doctors,
                (SELECT COUNT(*) FROM beds)::int AS total_beds,
                (SELECT COUNT(*) FROM beds WHERE status = 'FREE')::int AS free_beds,
                (SELECT COUNT(*) FROM beds WHERE status = 'OCCUPIED')::int AS occupied_beds,
                (SELECT COUNT(*) FROM appointments WHERE appointment_date >= CURRENT_DATE)::int AS upcoming_appointments,
                (SELECT COUNT(*) FROM medicines WHERE quantity_in_stock < 50)::int AS low_stock_medicines
        `);
        res.json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// PATIENTS
app.get('/api/v1/patients', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM patients WHERE hospital_id = $1 ORDER BY created_at DESC', [HOSPITAL_ID]);
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/v1/patients', requireAuth, async (req, res) => {
    try {
        const { first_name, last_name, email, phone, age, gender } = req.body;
        if (!first_name || !last_name || !email || !phone) return res.status(400).json({ error: 'first_name, last_name, email, and phone are required' });
        const patientIdNumber = 'P-' + Date.now().toString().slice(-6);
        const result = await pool.query(
            `INSERT INTO patients (hospital_id, patient_id_number, first_name, last_name, email, phone, age, gender)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [HOSPITAL_ID, patientIdNumber, first_name, last_name, email, phone, age || null, gender || null]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// DOCTORS
app.get('/api/v1/doctors', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM doctors WHERE hospital_id = $1 ORDER BY created_at DESC', [HOSPITAL_ID]);
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/v1/doctors', requireAuth, async (req, res) => {
    try {
        const { first_name, last_name, email, phone, specialization } = req.body;
        if (!first_name || !last_name || !email) return res.status(400).json({ error: 'first_name, last_name, and email are required' });
        const result = await pool.query(
            `INSERT INTO doctors (hospital_id, first_name, last_name, email, phone, specialization)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [HOSPITAL_ID, first_name, last_name, email, phone || null, specialization || null]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// BEDS
app.get('/api/v1/beds', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM beds WHERE hospital_id = $1 ORDER BY bed_number ASC', [HOSPITAL_ID]);
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/v1/beds/:id', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['FREE', 'OCCUPIED'].includes(status)) return res.status(400).json({ error: 'status must be FREE or OCCUPIED' });
        const result = await pool.query('UPDATE beds SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Bed not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// APPOINTMENTS
app.get('/api/v1/appointments', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
                   d.first_name AS doctor_first_name, d.last_name AS doctor_last_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.hospital_id = $1 ORDER BY a.appointment_date ASC`, [HOSPITAL_ID]);
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/v1/appointments', requireAuth, async (req, res) => {
    try {
        const { patient_id, doctor_id, appointment_date, status } = req.body;
        if (!patient_id || !doctor_id) return res.status(400).json({ error: 'patient_id and doctor_id are required' });
        const result = await pool.query(
            `INSERT INTO appointments (hospital_id, patient_id, doctor_id, appointment_date, status)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [HOSPITAL_ID, patient_id, doctor_id, appointment_date || null, status || 'SCHEDULED']
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// MEDICINES
app.get('/api/v1/medicines', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM medicines WHERE hospital_id = $1 ORDER BY medicine_name ASC', [HOSPITAL_ID]);
        res.json({ success: true, data: result.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/v1/medicines', requireAuth, async (req, res) => {
    try {
        const { medicine_name, quantity_in_stock, unit_price, expiry_date } = req.body;
        if (!medicine_name) return res.status(400).json({ error: 'medicine_name is required' });
        const result = await pool.query(
            `INSERT INTO medicines (hospital_id, medicine_name, quantity_in_stock, unit_price, expiry_date)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [HOSPITAL_ID, medicine_name, quantity_in_stock || 0, unit_price || null, expiry_date || null]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅ MediX HMS API running on port ${PORT}`));
