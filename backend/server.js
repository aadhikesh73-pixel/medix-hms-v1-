const express = require('express');
const pg = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'MediX HMS running', time: new Date() });
});

app.get('/api/v1/hospitals', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hospitals');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ MediX HMS API running on port ${PORT}`);
});
