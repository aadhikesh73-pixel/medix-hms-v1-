-- ================================================================
-- MediX HMS v4 — Complete Admin Database Schema
-- 14 tables with indexes, constraints, and seed data
-- ================================================================

-- 1. HOSPITALS
CREATE TABLE IF NOT EXISTS hospitals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    total_beds INTEGER DEFAULT 0,
    icu_beds INTEGER DEFAULT 0,
    logo_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. DEPARTMENTS
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    name VARCHAR(100) NOT NULL,
    hod_name VARCHAR(100),
    floor_number INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. USERS
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'STAFF',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. DOCTORS
CREATE TABLE IF NOT EXISTS doctors (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    department_id INTEGER REFERENCES departments(id),
    qr_code_id VARCHAR(50) UNIQUE,
    registration_number VARCHAR(50) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    specialization VARCHAR(100),
    qualifications TEXT,
    experience_years INTEGER DEFAULT 0,
    availability_status VARCHAR(20) DEFAULT 'OFF_DUTY',
    shift VARCHAR(20) DEFAULT 'MORNING',
    rating DECIMAL(2,1) DEFAULT 0.0,
    profile_photo_url VARCHAR(500),
    bio TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. PATIENTS
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    patient_id_number VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20) NOT NULL,
    date_of_birth DATE,
    age INTEGER,
    gender VARCHAR(20),
    blood_group VARCHAR(10),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(50),
    medical_history TEXT,
    allergies TEXT,
    admission_status VARCHAR(20) DEFAULT 'OPD',
    current_bed_id INTEGER,
    attending_doctor_id INTEGER REFERENCES doctors(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. BEDS
CREATE TABLE IF NOT EXISTS beds (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    bed_number VARCHAR(20) NOT NULL,
    floor_number INTEGER NOT NULL DEFAULT 1,
    block VARCHAR(10) DEFAULT 'A',
    room_number VARCHAR(20),
    bed_type VARCHAR(20) DEFAULT 'NORMAL',
    status VARCHAR(20) DEFAULT 'FREE',
    current_patient_id INTEGER REFERENCES patients(id),
    assigned_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hospital_id, bed_number)
);

-- 7. APPOINTMENTS
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    appointment_code VARCHAR(30) UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    department_id INTEGER REFERENCES departments(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME,
    appointment_type VARCHAR(30) DEFAULT 'OPD',
    status VARCHAR(20) DEFAULT 'SCHEDULED',
    reason TEXT,
    notes TEXT,
    duration_minutes INTEGER DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    type VARCHAR(50),
    payment_terms VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. MEDICINES
CREATE TABLE IF NOT EXISTS medicines (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    medicine_name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    category VARCHAR(100),
    strength VARCHAR(50),
    unit VARCHAR(30) DEFAULT 'units',
    quantity_in_stock INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 50,
    unit_price DECIMAL(10,2),
    manufacturer VARCHAR(255),
    batch_number VARCHAR(100),
    expiry_date DATE,
    storage_location VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    order_code VARCHAR(30) UNIQUE,
    order_type VARCHAR(50) DEFAULT 'MEDICINE',
    items JSONB,
    total_amount DECIMAL(12,2),
    status VARCHAR(20) DEFAULT 'PENDING',
    payment_status VARCHAR(20) DEFAULT 'UNPAID',
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expected_delivery DATE,
    actual_delivery DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    invoice_number VARCHAR(30) UNIQUE,
    invoice_date DATE DEFAULT CURRENT_DATE,
    services JSONB,
    subtotal DECIMAL(12,2) DEFAULT 0,
    tax_percentage DECIMAL(5,2) DEFAULT 5.0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) DEFAULT 0,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'UNPAID',
    payment_method VARCHAR(50),
    sector VARCHAR(50),
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. FINANCIAL TRANSACTIONS
CREATE TABLE IF NOT EXISTS financial_transactions (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    transaction_type VARCHAR(20) NOT NULL,
    category VARCHAR(100),
    sector VARCHAR(50),
    amount DECIMAL(12,2),
    description TEXT,
    invoice_id INTEGER REFERENCES invoices(id),
    order_id INTEGER REFERENCES orders(id),
    payment_method VARCHAR(50),
    transaction_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. STAFF ATTENDANCE
CREATE TABLE IF NOT EXISTS staff_attendance (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    qr_code_id VARCHAR(50),
    check_in TIMESTAMP,
    check_out TIMESTAMP,
    attendance_date DATE DEFAULT CURRENT_DATE,
    shift VARCHAR(20),
    method VARCHAR(20) DEFAULT 'QR',
    status VARCHAR(20) DEFAULT 'PRESENT',
    duration_minutes INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 14. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    sector VARCHAR(50),
    priority VARCHAR(20) DEFAULT 'LOW',
    title VARCHAR(255),
    message TEXT,
    action_url VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_doctors_hospital ON doctors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_doctors_status ON doctors(availability_status);
CREATE INDEX IF NOT EXISTS idx_patients_hospital ON patients(hospital_id);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_pid ON patients(patient_id_number);
CREATE INDEX IF NOT EXISTS idx_beds_hospital ON beds(hospital_id);
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
CREATE INDEX IF NOT EXISTS idx_beds_floor ON beds(floor_number);
CREATE INDEX IF NOT EXISTS idx_appt_hospital ON appointments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medicines_hospital ON medicines(hospital_id);
CREATE INDEX IF NOT EXISTS idx_medicines_expiry ON medicines(expiry_date);
CREATE INDEX IF NOT EXISTS idx_orders_hospital ON orders(hospital_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_attendance_hospital ON staff_attendance(hospital_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON staff_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_doctor ON staff_attendance(doctor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_hospital ON invoices(hospital_id);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_transactions_hospital ON financial_transactions(hospital_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON financial_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_sector ON financial_transactions(sector);
CREATE INDEX IF NOT EXISTS idx_notif_hospital ON notifications(hospital_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ================================================================
-- SEED DATA
-- ================================================================

-- Hospital
INSERT INTO hospitals (name, address, phone, email, city, state, pincode, total_beds, icu_beds)
VALUES ('Central Medical Institute', '123 Medical Plaza, Anna Salai', '+91-44-2123-4567', 'admin@centralmedical.com', 'Chennai', 'Tamil Nadu', '600001', 248, 50)
ON CONFLICT DO NOTHING;

-- Departments
INSERT INTO departments (hospital_id, name, hod_name, floor_number) VALUES
(1, 'Cardiology', 'Dr. Rajesh Sharma', 2),
(1, 'General Surgery', 'Dr. Kavya Patel', 3),
(1, 'Neurology', 'Dr. Meera Krishnan', 2),
(1, 'Orthopedics', 'Dr. Suresh Nair', 4),
(1, 'Pediatrics', 'Dr. Anita Rao', 1),
(1, 'General Medicine', 'Dr. Vijay Menon', 1),
(1, 'ICU', 'Dr. Rajesh Sharma', 5)
ON CONFLICT DO NOTHING;

-- Suppliers
INSERT INTO suppliers (hospital_id, name, phone, email, type, payment_terms) VALUES
(1, 'MedPharm Pvt Ltd', '+91-44-2234-5678', 'orders@medpharm.in', 'MEDICINE', 'Net 30'),
(1, 'BOC India Ltd', '+91-80-4567-8901', 'orders@bocindia.com', 'OXYGEN', 'Net 15'),
(1, 'HealthEquip Co', '+91-22-3456-7890', 'info@healthequip.in', 'EQUIPMENT', 'Net 45')
ON CONFLICT DO NOTHING;

-- Doctors
INSERT INTO doctors (hospital_id, department_id, qr_code_id, first_name, last_name, email, phone, specialization, qualifications, experience_years, availability_status, shift, rating)
VALUES
(1, 1, 'DOC-0042', 'Rajesh', 'Sharma', 'rajesh.sharma@medix.com', '+91-98001-23456', 'Cardiology', 'MBBS, MD (Cardiology)', 15, 'ACTIVE', 'MORNING', 4.9),
(1, 2, 'DOC-0018', 'Kavya', 'Patel', 'kavya.patel@medix.com', '+91-99102-34567', 'General Surgery', 'MBBS, MS (Surgery)', 12, 'ACTIVE', 'AFTERNOON', 4.8),
(1, 4, 'DOC-0031', 'Suresh', 'Nair', 'suresh.nair@medix.com', '+91-97003-45678', 'Orthopedics', 'MBBS, MS (Ortho)', 10, 'ON_CALL', 'ROTATING', 4.7),
(1, 3, 'DOC-0056', 'Vijay', 'Menon', 'vijay.menon@medix.com', '+91-96104-56789', 'Neurology', 'MBBS, DM (Neurology)', 8, 'OFF_DUTY', 'MORNING', 4.6),
(1, 6, 'DOC-0027', 'Meera', 'Krishnan', 'meera.krishnan@medix.com', '+91-95205-67890', 'General Medicine', 'MBBS, MD (Medicine)', 18, 'ACTIVE', 'MORNING', 4.9),
(1, 5, 'DOC-0039', 'Anita', 'Rao', 'anita.rao@medix.com', '+91-94306-78901', 'Pediatrics', 'MBBS, MD (Pediatrics)', 14, 'ACTIVE', 'MORNING', 5.0)
ON CONFLICT DO NOTHING;

-- Patients
INSERT INTO patients (hospital_id, patient_id_number, first_name, last_name, email, phone, age, gender, blood_group, city, medical_history, admission_status, attending_doctor_id)
VALUES
(1, 'PT-2841', 'Ravi', 'Kumar', 'ravi@example.com', '+91-98765-43210', 58, 'M', 'O+', 'Chennai', 'Hypertension, Diabetes', 'ADMITTED', 1),
(1, 'PT-3012', 'Meena', 'Iyer', 'meena@example.com', '+91-98765-43211', 42, 'F', 'A+', 'Chennai', 'Post-Surgery Recovery', 'ADMITTED', 2),
(1, 'PT-2755', 'Arjun', 'Das', 'arjun@example.com', '+91-98765-43212', 34, 'M', 'B+', 'Coimbatore', 'Knee Injury', 'ADMITTED', 3),
(1, 'PT-3104', 'Sunita', 'Rao', 'sunita@example.com', '+91-98765-43213', 67, 'F', 'O-', 'Chennai', 'Stroke Patient', 'ICU', 4),
(1, 'PT-2988', 'Priya', 'Nambiar', 'priya@example.com', '+91-98765-43214', 29, 'F', 'AB+', 'Madurai', 'Fever', 'OPD', 5),
(1, 'PT-3201', 'Mohan', 'Pillai', 'mohan@example.com', '+91-98765-43215', 71, 'M', 'A-', 'Chennai', 'Cardiac Arrest History', 'ICU', 1)
ON CONFLICT DO NOTHING;

-- Beds (Floor 1 Block A, Floor 2 Block B, ICU)
INSERT INTO beds (hospital_id, bed_number, floor_number, block, room_number, bed_type, status) VALUES
(1,'A-101',1,'A','101','NORMAL','FREE'),
(1,'A-102',1,'A','102','NORMAL','OCCUPIED'),
(1,'A-103',1,'A','103','NORMAL','FREE'),
(1,'A-104',1,'A','104','NORMAL','CLEANING'),
(1,'A-105',1,'A','105','NORMAL','FREE'),
(1,'A-106',1,'A','106','NORMAL','OCCUPIED'),
(1,'A-107',1,'A','107','NORMAL','FREE'),
(1,'A-108',1,'A','108','NORMAL','FREE'),
(1,'B-201',2,'B','201','NORMAL','OCCUPIED'),
(1,'B-202',2,'B','202','NORMAL','FREE'),
(1,'B-203',2,'B','203','NORMAL','OCCUPIED'),
(1,'B-204',2,'B','204','NORMAL','CLEANING'),
(1,'B-205',2,'B','205','NORMAL','FREE'),
(1,'B-206',2,'B','206','NORMAL','OCCUPIED'),
(1,'C-301',3,'C','301','DELUXE','FREE'),
(1,'C-302',3,'C','302','DELUXE','OCCUPIED'),
(1,'C-303',3,'C','303','DELUXE','FREE'),
(1,'C-304',3,'C','304','DELUXE','FREE'),
(1,'ICU-01',5,'ICU','ICU-01','ICU','OCCUPIED'),
(1,'ICU-02',5,'ICU','ICU-02','ICU','FREE'),
(1,'ICU-03',5,'ICU','ICU-03','ICU','OCCUPIED'),
(1,'ICU-04',5,'ICU','ICU-04','ICU','FREE'),
(1,'ICU-05',5,'ICU','ICU-05','ICU','OCCUPIED'),
(1,'ICU-06',5,'ICU','ICU-06','ICU','FREE')
ON CONFLICT DO NOTHING;

-- Medicines
INSERT INTO medicines (hospital_id, supplier_id, medicine_name, generic_name, category, strength, unit, quantity_in_stock, reorder_level, unit_price, manufacturer, batch_number, expiry_date, storage_location)
VALUES
(1, 1, 'Paracetamol 500mg', 'Acetaminophen', 'Analgesic', '500mg', 'tablets', 720, 200, 5.00, 'Cipla Ltd', 'B2024001', '2025-12-31', 'Shelf A1'),
(1, 1, 'Amoxicillin 250mg', 'Amoxicillin', 'Antibiotic', '250mg', 'capsules', 90, 250, 12.00, 'Dr. Reddy', 'B2024002', '2025-08-15', 'Shelf B2'),
(1, 2, 'Oxygen Cylinder D-type', 'Medical O2', 'Medical Gas', '40L', 'units', 11, 20, 1000.00, 'BOC India', 'OX2024001', '2027-01-01', 'Gas Store'),
(1, 1, 'Insulin 30U/ml', 'Insulin', 'Antidiabetic', '30U/ml', 'vials', 200, 100, 85.00, 'Novo Nordisk', 'B2024003', '2025-06-30', 'Cold Storage'),
(1, 1, 'Metformin 500mg', 'Metformin HCl', 'Antidiabetic', '500mg', 'tablets', 1240, 300, 8.50, 'Sun Pharma', 'B2024004', '2026-03-31', 'Shelf A2'),
(1, 1, 'Morphine 10mg/ml', 'Morphine Sulfate', 'Opioid Analgesic', '10mg/ml', 'ampoules', 30, 100, 250.00, 'Hameln', 'B2024005', '2025-04-30', 'Controlled Store'),
(1, 1, 'Aspirin 75mg', 'Acetylsalicylic Acid', 'Antiplatelet', '75mg', 'tablets', 800, 200, 3.00, 'Bayer', 'B2024006', '2026-01-15', 'Shelf A3'),
(1, 1, 'Atorvastatin 20mg', 'Atorvastatin', 'Statin', '20mg', 'tablets', 450, 150, 18.00, 'Pfizer', 'B2024007', '2026-06-30', 'Shelf B1')
ON CONFLICT DO NOTHING;

-- Appointments
INSERT INTO appointments (hospital_id, appointment_code, patient_id, doctor_id, department_id, appointment_date, appointment_time, appointment_type, status, reason)
VALUES
(1, 'APT-0001', 1, 1, 1, CURRENT_DATE, '09:00', 'OPD', 'SCHEDULED', 'Cardiac Follow-up'),
(1, 'APT-0002', 2, 2, 2, CURRENT_DATE, '10:30', 'POST_OP', 'COMPLETED', 'Post-surgery review'),
(1, 'APT-0003', 3, 3, 4, CURRENT_DATE, '11:00', 'OPD', 'SCHEDULED', 'Knee pain consultation'),
(1, 'APT-0004', 5, 5, 6, CURRENT_DATE, '14:00', 'OPD', 'SCHEDULED', 'Fever check'),
(1, 'APT-0005', 6, 1, 1, CURRENT_DATE + 1, '09:30', 'ICU_REVIEW', 'SCHEDULED', 'Cardiac ICU review')
ON CONFLICT DO NOTHING;

-- Orders
INSERT INTO orders (hospital_id, supplier_id, order_code, order_type, items, total_amount, status, payment_status, expected_delivery)
VALUES
(1, 1, 'ORD-0001', 'MEDICINE', '[{"name":"Amoxicillin 250mg","qty":500,"price":12}]', 6000.00, 'DELIVERED', 'PAID', CURRENT_DATE - 2),
(1, 2, 'ORD-0002', 'OXYGEN', '[{"name":"O2 Cylinder D-type","qty":30,"price":1000}]', 30000.00, 'DISPATCHED', 'PAID', CURRENT_DATE + 1),
(1, 1, 'ORD-0003', 'MEDICINE', '[{"name":"Morphine 10mg/ml","qty":200,"price":250}]', 50000.00, 'PENDING', 'UNPAID', CURRENT_DATE + 3)
ON CONFLICT DO NOTHING;

-- Notifications
INSERT INTO notifications (hospital_id, sector, priority, title, message, is_read) VALUES
(1, 'ICU', 'CRITICAL', 'Patient in ICU-03 is critical', 'BP dropped to 70/40. Immediate intervention required. Attending: Dr. Sharma', FALSE),
(1, 'ICU', 'HIGH', 'ICU ventilator fault — Unit I-07', 'Ventilator alarm triggered. Engineering team notified.', FALSE),
(1, 'PHARMACY', 'HIGH', 'O₂ Cylinder stock critical', 'Only 11 units remaining. Minimum threshold: 20. Place order immediately.', FALSE),
(1, 'PHARMACY', 'MEDIUM', 'Morphine stock low', '30 ampoules remaining. Reorder level: 100. Contact vendor.', FALSE),
(1, 'APPOINTMENTS', 'LOW', 'Appointment rescheduled', 'APT-0003 moved to tomorrow 11:00 AM at Dr. Nair request.', TRUE),
(1, 'PATIENT', 'HIGH', 'Emergency walk-in registered', 'Patient Ramesh Kumar, 62M. Chest pain. Assigned to A&E ward.', FALSE)
ON CONFLICT DO NOTHING;

-- Financial Transactions (sample)
INSERT INTO financial_transactions (hospital_id, transaction_type, category, sector, amount, description, transaction_date) VALUES
(1, 'REVENUE', 'Consultation Fee', 'OPD', 8500.00, 'OPD Revenue Jan', CURRENT_DATE - 30),
(1, 'REVENUE', 'Surgery Fee', 'SURGERY', 65000.00, 'Surgery Revenue Jan', CURRENT_DATE - 30),
(1, 'REVENUE', 'Lab Tests', 'LAB', 12000.00, 'Lab Revenue Jan', CURRENT_DATE - 30),
(1, 'REVENUE', 'Pharmacy Sales', 'PHARMACY', 18000.00, 'Pharmacy Revenue Jan', CURRENT_DATE - 30),
(1, 'REVENUE', 'ICU Charges', 'ICU', 45000.00, 'ICU Revenue Jan', CURRENT_DATE - 30),
(1, 'EXPENSE', 'Salaries', 'OPERATIONS', 85000.00, 'Staff Salaries Jan', CURRENT_DATE - 30),
(1, 'EXPENSE', 'Medicine Purchase', 'PHARMACY', 42000.00, 'Medicine Orders Jan', CURRENT_DATE - 30),
(1, 'EXPENSE', 'Utilities', 'OPERATIONS', 18000.00, 'Electricity and Water Jan', CURRENT_DATE - 30),
(1, 'REVENUE', 'Consultation Fee', 'OPD', 9200.00, 'OPD Revenue Feb', CURRENT_DATE - 0),
(1, 'REVENUE', 'Surgery Fee', 'SURGERY', 72000.00, 'Surgery Revenue Feb', CURRENT_DATE - 0),
(1, 'REVENUE', 'Lab Tests', 'LAB', 14500.00, 'Lab Revenue Feb', CURRENT_DATE - 0),
(1, 'REVENUE', 'Pharmacy Sales', 'PHARMACY', 21000.00, 'Pharmacy Revenue Feb', CURRENT_DATE - 0),
(1, 'REVENUE', 'ICU Charges', 'ICU', 48000.00, 'ICU Revenue Feb', CURRENT_DATE - 0),
(1, 'EXPENSE', 'Salaries', 'OPERATIONS', 85000.00, 'Staff Salaries Feb', CURRENT_DATE - 0),
(1, 'EXPENSE', 'Medicine Purchase', 'PHARMACY', 38000.00, 'Medicine Orders Feb', CURRENT_DATE - 0),
(1, 'EXPENSE', 'Utilities', 'OPERATIONS', 19000.00, 'Electricity and Water Feb', CURRENT_DATE - 0)
ON CONFLICT DO NOTHING;

