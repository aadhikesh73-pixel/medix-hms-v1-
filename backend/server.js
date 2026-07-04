const express = require('express');
const pg = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'medix-dev-secret-2026';
const SETUP_KEY  = process.env.ADMIN_SETUP_KEY || 'medix-setup-2026';
const H_ID       = 1;

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ────────── HELPERS ──────────
const sign = u => jwt.sign({ sub: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '7d' });

const auth = (req, res, next) => {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'Missing token' });
    try { req.user = jwt.verify(t, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};

const emit = (event, data) => io.emit(event, data);

// ────────── WEBSOCKET ──────────
io.on('connection', socket => {
    console.log('WS client connected:', socket.id);
    socket.on('disconnect', () => console.log('WS disconnected:', socket.id));
});

// ────────── HEALTH ──────────
app.get('/api/health', (req, res) => res.json({ status: 'MediX HMS v4 running', time: new Date() }));

// ────────── AUTH ──────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, role, setupKey } = req.body;
        if (setupKey !== SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });
        if (!email || !password)   return res.status(400).json({ error: 'Email and password required' });
        const hash = await bcrypt.hash(password, 10);
        const user = await pool.query(
            `INSERT INTO users (hospital_id, username, email, password_hash, role)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
             RETURNING id, email, role`,
            [H_ID, email.split('@')[0], email, hash, role || 'ADMIN']
        );
        res.status(201).json({ success: true, user: user.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const r = await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
        const u = r.rows[0];
        if (!u || !(await bcrypt.compare(password, u.password_hash)))
            return res.status(401).json({ error: 'Invalid email or password' });
        await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [u.id]);
        res.json({ success: true, token: sign(u), user: { email: u.email, role: u.role, username: u.username } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── OVERVIEW ──────────
app.get('/api/v1/overview', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1) AS total_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='ADMITTED') AS in_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='ICU') AS icu_patients,
                (SELECT COUNT(*)::int FROM patients WHERE hospital_id=$1 AND admission_status='OPD') AS opd_patients,
                (SELECT COUNT(*)::int FROM doctors WHERE hospital_id=$1) AS total_doctors,
                (SELECT COUNT(*)::int FROM doctors WHERE hospital_id=$1 AND availability_status='ACTIVE') AS doctors_on_duty,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1) AS total_beds,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1 AND status='FREE') AS free_beds,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1 AND status='OCCUPIED') AS occupied_beds,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1 AND status='CLEANING') AS cleaning_beds,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1 AND bed_type='ICU') AS total_icu,
                (SELECT COUNT(*)::int FROM beds WHERE hospital_id=$1 AND bed_type='ICU' AND status='FREE') AS free_icu,
                (SELECT COUNT(*)::int FROM appointments WHERE hospital_id=$1 AND appointment_date=CURRENT_DATE) AS today_appointments,
                (SELECT COUNT(*)::int FROM appointments WHERE hospital_id=$1 AND appointment_date>=CURRENT_DATE AND status='SCHEDULED') AS upcoming_appointments,
                (SELECT COUNT(*)::int FROM medicines WHERE hospital_id=$1 AND quantity_in_stock < reorder_level) AS low_stock,
                (SELECT COUNT(*)::int FROM medicines WHERE hospital_id=$1 AND expiry_date <= CURRENT_DATE + 30) AS expiring_soon,
                (SELECT COUNT(*)::int FROM orders WHERE hospital_id=$1 AND status='PENDING') AS pending_orders,
                (SELECT COUNT(*)::int FROM notifications WHERE hospital_id=$1 AND is_read=FALSE) AS unread_notifications,
                (SELECT COALESCE(SUM(amount),0)::NUMERIC FROM financial_transactions WHERE hospital_id=$1 AND transaction_type='REVENUE' AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())) AS monthly_revenue,
                (SELECT COALESCE(SUM(amount),0)::NUMERIC FROM financial_transactions WHERE hospital_id=$1 AND transaction_type='EXPENSE' AND DATE_TRUNC('month',transaction_date)=DATE_TRUNC('month',NOW())) AS monthly_expense
        `, [H_ID]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── PATIENTS ──────────
app.get('/api/v1/patients', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT p.*, d.first_name||' '||d.last_name AS doctor_name, b.bed_number
            FROM patients p
            LEFT JOIN doctors d ON p.attending_doctor_id = d.id
            LEFT JOIN beds b ON p.current_bed_id = b.id
            WHERE p.hospital_id=$1 ORDER BY p.created_at DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/patients', auth, async (req, res) => {
    try {
        const { first_name, last_name, email, phone, age, gender, blood_group, address, medical_history, allergies, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, admission_status } = req.body;
        if (!first_name || !last_name || !phone) return res.status(400).json({ error: 'first_name, last_name, phone required' });
        const pid = 'PT-' + Date.now().toString().slice(-4) + Math.floor(Math.random()*100);
        const r = await pool.query(
            `INSERT INTO patients (hospital_id, patient_id_number, first_name, last_name, email, phone, age, gender, blood_group, address, medical_history, allergies, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, admission_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [H_ID, pid, first_name, last_name, email||null, phone, age||null, gender||null, blood_group||null, address||null, medical_history||null, allergies||null, emergency_contact_name||null, emergency_contact_phone||null, emergency_contact_relation||null, admission_status||'OPD']
        );
        emit('patient:admitted', r.rows[0]);
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/v1/patients/:id', auth, async (req, res) => {
    try {
        const fields = ['first_name','last_name','email','phone','age','gender','blood_group','admission_status','medical_history','allergies'];
        const sets = fields.filter(f => req.body[f] !== undefined).map((f,i) => `${f}=$${i+2}`);
        const vals = fields.filter(f => req.body[f] !== undefined).map(f => req.body[f]);
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
        const r = await pool.query(`UPDATE patients SET ${sets.join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...vals]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/v1/patients/:id', auth, async (req, res) => {
    try {
        await pool.query('UPDATE patients SET is_active=FALSE WHERE id=$1', [req.params.id]);
        res.json({ success: true, message: 'Patient deactivated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── DOCTORS ──────────
app.get('/api/v1/doctors', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT d.*, dep.name AS department_name,
                   (SELECT COUNT(*)::int FROM appointments a WHERE a.doctor_id=d.id AND a.appointment_date=CURRENT_DATE) AS today_appointments,
                   (SELECT COUNT(*)::int FROM patients p WHERE p.attending_doctor_id=d.id) AS total_patients
            FROM doctors d LEFT JOIN departments dep ON d.department_id=dep.id
            WHERE d.hospital_id=$1 AND d.is_active=TRUE ORDER BY d.created_at DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/doctors', auth, async (req, res) => {
    try {
        const { first_name, last_name, email, phone, specialization, qualifications, experience_years, department_id, shift } = req.body;
        if (!first_name || !last_name || !email) return res.status(400).json({ error: 'first_name, last_name, email required' });
        const qrId = 'DOC-' + Date.now().toString().slice(-4);
        const r = await pool.query(
            `INSERT INTO doctors (hospital_id, department_id, qr_code_id, first_name, last_name, email, phone, specialization, qualifications, experience_years, shift)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [H_ID, department_id||null, qrId, first_name, last_name, email, phone||null, specialization||null, qualifications||null, experience_years||0, shift||'MORNING']
        );
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/doctors/:id/status', auth, async (req, res) => {
    try {
        const { status } = req.body;
        const r = await pool.query('UPDATE doctors SET availability_status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
        emit('doctor:status_changed', r.rows[0]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── BEDS ──────────
app.get('/api/v1/beds', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT b.*, p.first_name||' '||p.last_name AS patient_name, p.patient_id_number
            FROM beds b LEFT JOIN patients p ON b.current_patient_id=p.id
            WHERE b.hospital_id=$1 ORDER BY b.floor_number, b.block, b.bed_number`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/beds/:id', auth, async (req, res) => {
    try {
        const { status, patient_id } = req.body;
        const r = await pool.query(
            `UPDATE beds SET status=$1, current_patient_id=$2, assigned_date=CASE WHEN $1='OCCUPIED' THEN NOW() ELSE NULL END
             WHERE id=$3 RETURNING *`, [status, patient_id||null, req.params.id]);
        emit('bed:status_changed', r.rows[0]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/beds/stats', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT floor_number, block,
                   COUNT(*)::int AS total,
                   SUM(CASE WHEN status='FREE' THEN 1 ELSE 0 END)::int AS free,
                   SUM(CASE WHEN status='OCCUPIED' THEN 1 ELSE 0 END)::int AS occupied,
                   SUM(CASE WHEN status='CLEANING' THEN 1 ELSE 0 END)::int AS cleaning,
                   SUM(CASE WHEN status='MAINTENANCE' THEN 1 ELSE 0 END)::int AS maintenance
            FROM beds WHERE hospital_id=$1 GROUP BY floor_number, block ORDER BY floor_number, block`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── APPOINTMENTS ──────────
app.get('/api/v1/appointments', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT a.*, p.first_name||' '||p.last_name AS patient_name, p.patient_id_number,
                   d.first_name||' '||d.last_name AS doctor_name, d.specialization,
                   dep.name AS department_name
            FROM appointments a
            JOIN patients p ON a.patient_id=p.id
            JOIN doctors d ON a.doctor_id=d.id
            LEFT JOIN departments dep ON a.department_id=dep.id
            WHERE a.hospital_id=$1 ORDER BY a.appointment_date DESC, a.appointment_time DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/appointments', auth, async (req, res) => {
    try {
        const { patient_id, doctor_id, department_id, appointment_date, appointment_time, appointment_type, reason } = req.body;
        if (!patient_id || !doctor_id || !appointment_date) return res.status(400).json({ error: 'patient_id, doctor_id, appointment_date required' });
        const code = 'APT-' + Date.now().toString().slice(-4);
        const r = await pool.query(
            `INSERT INTO appointments (hospital_id, appointment_code, patient_id, doctor_id, department_id, appointment_date, appointment_time, appointment_type, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [H_ID, code, patient_id, doctor_id, department_id||null, appointment_date, appointment_time||null, appointment_type||'OPD', reason||null]
        );
        emit('appointment:scheduled', r.rows[0]);
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/appointments/:id/status', auth, async (req, res) => {
    try {
        const r = await pool.query('UPDATE appointments SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── MEDICINES ──────────
app.get('/api/v1/medicines', auth, async (req, res) => {
    try {
        const r = await pool.query(`
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/medicines', auth, async (req, res) => {
    try {
        const { medicine_name, generic_name, category, strength, unit, quantity_in_stock, reorder_level, unit_price, manufacturer, batch_number, expiry_date, storage_location, supplier_id } = req.body;
        if (!medicine_name) return res.status(400).json({ error: 'medicine_name required' });
        const r = await pool.query(
            `INSERT INTO medicines (hospital_id, supplier_id, medicine_name, generic_name, category, strength, unit, quantity_in_stock, reorder_level, unit_price, manufacturer, batch_number, expiry_date, storage_location)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [H_ID, supplier_id||null, medicine_name, generic_name||null, category||null, strength||null, unit||'units', quantity_in_stock||0, reorder_level||50, unit_price||null, manufacturer||null, batch_number||null, expiry_date||null, storage_location||null]
        );
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/medicines/:id/stock', auth, async (req, res) => {
    try {
        const r = await pool.query('UPDATE medicines SET quantity_in_stock=quantity_in_stock+$1 WHERE id=$2 RETURNING *', [req.body.quantity, req.params.id]);
        if (r.rows[0].quantity_in_stock < r.rows[0].reorder_level) emit('medicine:low_stock', r.rows[0]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── ATTENDANCE ──────────
app.get('/api/v1/attendance', auth, async (req, res) => {
    try {
        const date = req.query.date || 'CURRENT_DATE';
        const r = await pool.query(`
            SELECT a.*, d.first_name||' '||d.last_name AS staff_name, d.qr_code_id, d.specialization,
                   dep.name AS department_name
            FROM staff_attendance a
            JOIN doctors d ON a.doctor_id=d.id
            LEFT JOIN departments dep ON d.department_id=dep.id
            WHERE a.hospital_id=$1 AND a.attendance_date=CURRENT_DATE
            ORDER BY a.check_in DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/attendance/checkin', auth, async (req, res) => {
    try {
        const { qr_code_id, staff_id, method } = req.body;
        let doctorId = staff_id;
        if (qr_code_id) {
            const d = await pool.query('SELECT id FROM doctors WHERE qr_code_id=$1', [qr_code_id]);
            if (!d.rows.length) return res.status(404).json({ error: 'Staff not found for QR code: ' + qr_code_id });
            doctorId = d.rows[0].id;
        }
        const existing = await pool.query('SELECT id FROM staff_attendance WHERE doctor_id=$1 AND attendance_date=CURRENT_DATE', [doctorId]);
        if (existing.rows.length) return res.status(409).json({ error: 'Already checked in today' });
        const r = await pool.query(
            `INSERT INTO staff_attendance (hospital_id, doctor_id, qr_code_id, check_in, attendance_date, method, status)
             VALUES ($1,$2,$3,NOW(),CURRENT_DATE,$4,'PRESENT') RETURNING *`,
            [H_ID, doctorId, qr_code_id||null, method||'QR']
        );
        const doc = await pool.query('SELECT first_name, last_name FROM doctors WHERE id=$1', [doctorId]);
        emit('staff:checked_in', { ...r.rows[0], ...doc.rows[0] });
        res.status(201).json({ success: true, data: r.rows[0], staff: doc.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/attendance/checkout', auth, async (req, res) => {
    try {
        const { qr_code_id, staff_id } = req.body;
        let doctorId = staff_id;
        if (qr_code_id) {
            const d = await pool.query('SELECT id FROM doctors WHERE qr_code_id=$1', [qr_code_id]);
            if (!d.rows.length) return res.status(404).json({ error: 'Staff not found' });
            doctorId = d.rows[0].id;
        }
        const r = await pool.query(
            `UPDATE staff_attendance SET check_out=NOW(),
             duration_minutes=EXTRACT(EPOCH FROM (NOW()-check_in))/60
             WHERE doctor_id=$1 AND attendance_date=CURRENT_DATE AND check_out IS NULL
             RETURNING *`, [doctorId]);
        if (!r.rows.length) return res.status(404).json({ error: 'No active check-in found' });
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── ORDERS ──────────
app.get('/api/v1/orders', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT o.*, s.name AS supplier_name FROM orders o
            LEFT JOIN suppliers s ON o.supplier_id=s.id
            WHERE o.hospital_id=$1 ORDER BY o.created_at DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/orders', auth, async (req, res) => {
    try {
        const { supplier_id, order_type, items, total_amount, expected_delivery, notes } = req.body;
        const code = 'ORD-' + Date.now().toString().slice(-4);
        const r = await pool.query(
            `INSERT INTO orders (hospital_id, supplier_id, order_code, order_type, items, total_amount, expected_delivery, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [H_ID, supplier_id||null, code, order_type||'MEDICINE', JSON.stringify(items||[]), total_amount||0, expected_delivery||null, notes||null]
        );
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/orders/:id/status', auth, async (req, res) => {
    try {
        const r = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── FINANCE ──────────
app.get('/api/v1/finance/overview', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS total_revenue,
                SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS total_expense,
                SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE -amount END) AS net_profit
            FROM financial_transactions WHERE hospital_id=$1
            AND DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', NOW())`, [H_ID]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/finance/by-sector', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT sector,
                   SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS revenue,
                   SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS expense
            FROM financial_transactions WHERE hospital_id=$1
            AND DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', NOW())
            GROUP BY sector ORDER BY revenue DESC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/finance/trend', auth, async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT DATE_TRUNC('month', transaction_date) AS month,
                   SUM(CASE WHEN transaction_type='REVENUE' THEN amount ELSE 0 END) AS revenue,
                   SUM(CASE WHEN transaction_type='EXPENSE' THEN amount ELSE 0 END) AS expense
            FROM financial_transactions WHERE hospital_id=$1
            AND transaction_date >= NOW() - INTERVAL '6 months'
            GROUP BY month ORDER BY month ASC`, [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/finance/transaction', auth, async (req, res) => {
    try {
        const { transaction_type, category, sector, amount, description, payment_method } = req.body;
        const r = await pool.query(
            `INSERT INTO financial_transactions (hospital_id, transaction_type, category, sector, amount, description, payment_method)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [H_ID, transaction_type, category||null, sector||null, amount, description||null, payment_method||null]
        );
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── NOTIFICATIONS ──────────
app.get('/api/v1/notifications', auth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM notifications WHERE hospital_id=$1 ORDER BY created_at DESC LIMIT 50', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/notifications/:id/read', auth, async (req, res) => {
    try {
        const r = await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1 RETURNING *', [req.params.id]);
        res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/v1/notifications/read-all', auth, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read=TRUE WHERE hospital_id=$1', [H_ID]);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/v1/notifications', auth, async (req, res) => {
    try {
        const { sector, priority, title, message, action_url } = req.body;
        const r = await pool.query(
            `INSERT INTO notifications (hospital_id, sector, priority, title, message, action_url)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [H_ID, sector||'GENERAL', priority||'LOW', title, message, action_url||null]
        );
        emit('notification:new', r.rows[0]);
        res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── DEPARTMENTS ──────────
app.get('/api/v1/departments', auth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM departments WHERE hospital_id=$1 ORDER BY name', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── SUPPLIERS ──────────
app.get('/api/v1/suppliers', auth, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM suppliers WHERE hospital_id=$1 ORDER BY name', [H_ID]);
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────── HOSPITALS ──────────
app.get('/api/v1/hospitals', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, name, city, state FROM hospitals');
        res.json({ success: true, data: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ MediX HMS v4 API running on port ${PORT}`));
