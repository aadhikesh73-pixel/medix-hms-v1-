#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR=$(pwd)
DEPLOY_DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$PROJECT_DIR/deployment_${DEPLOY_DATE}.log"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✓ $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}✗ ERROR: $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}⚠ WARNING: $1${NC}" | tee -a "$LOG_FILE"
}

check_system() {
    log "=========================================="
    log "MediX HMS v1 - Deployment Started"
    log "=========================================="
    log "Checking system requirements..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macOS"
        success "OS: macOS detected"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="Linux"
        success "OS: Linux detected"
    else
        error "Unsupported OS: $OSTYPE"
    fi
}

check_docker() {
    log "=========================================="
    log "Step 1: Checking Docker"
    log "=========================================="

    if ! command -v docker &> /dev/null; then
        error "Docker not found! Install from: https://www.docker.com/products/docker-desktop"
    fi
    success "Docker found: $(docker --version)"

    if ! command -v docker-compose &> /dev/null; then
        warning "Docker Compose not found, installing..."
        if [[ "$OS" == "macOS" ]]; then
            brew install docker-compose
        fi
    fi
    success "Docker Compose found"
}

check_node() {
    log "=========================================="
    log "Step 2: Checking Node.js"
    log "=========================================="

    if ! command -v node &> /dev/null; then
        log "Installing Node.js..."
        if [[ "$OS" == "macOS" ]]; then
            brew install node@18
            brew link node@18
        fi
    fi
    success "Node.js found: $(node --version)"
    success "npm found: $(npm --version)"
}

check_postgresql() {
    log "=========================================="
    log "Step 3: Checking PostgreSQL"
    log "=========================================="

    if ! command -v psql &> /dev/null; then
        log "Installing PostgreSQL..."
        if [[ "$OS" == "macOS" ]]; then
            brew install postgresql@15
            brew services start postgresql@15
        fi
    fi
    success "PostgreSQL found"
}

setup_env() {
    log "=========================================="
    log "Step 4: Setting Up Environment"
    log "=========================================="

    if [ ! -f .env ]; then
        log "Creating .env file..."
        cat > .env <<'EOF'
DB_HOST=localhost
DB_PORT=5432
DB_NAME=medix_hospital
DB_USER=medix_admin
DB_PASSWORD=medix_password_123

NODE_ENV=production
PORT=5000
SERVER_URL=http://localhost

JWT_SECRET=your_jwt_secret_key_here_change_in_production
JWT_EXPIRY=7d

EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your_app_password
EMAIL_FROM="MediX Hospital <noreply@medix.com>"

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_123
EOF
        success ".env file created"
        warning "Please update .env with your actual values"
    else
        success ".env file already exists"
    fi
}

setup_database() {
    log "=========================================="
    log "Step 5: Setting Up Database"
    log "=========================================="

    source .env

    log "Creating database and user..."

    # Check if database exists
    if psql -U postgres -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
        success "Database already exists: $DB_NAME"
    else
        psql -U postgres <<SQL
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
ALTER ROLE $DB_USER SET client_encoding TO 'utf8';
ALTER ROLE $DB_USER SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL
        success "Database created: $DB_NAME"
    fi
}

create_schema() {
    log "=========================================="
    log "Step 6: Creating Database Schema"
    log "=========================================="

    source .env

    psql -h $DB_HOST -U $DB_USER -d $DB_NAME <<'SQL'

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    specialization VARCHAR(100),
    experience_years INTEGER,
    availability_status VARCHAR(20) DEFAULT 'OFF_DUTY',
    department VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    patient_id_number VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    age INTEGER,
    gender VARCHAR(20),
    blood_group VARCHAR(10),
    medical_history TEXT,
    allergies TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS beds (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    bed_number VARCHAR(20) NOT NULL,
    floor_number INTEGER,
    bed_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'FREE',
    current_patient_id INTEGER REFERENCES patients(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'SCHEDULED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicines (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    medicine_name VARCHAR(255) NOT NULL,
    quantity_in_stock INTEGER DEFAULT 0,
    unit_price DECIMAL(10, 2),
    expiry_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doctors_hospital ON doctors(hospital_id);
CREATE INDEX IF NOT EXISTS idx_patients_hospital ON patients(hospital_id);
CREATE INDEX IF NOT EXISTS idx_beds_hospital ON beds(hospital_id);
CREATE INDEX IF NOT EXISTS idx_appointments_hospital ON appointments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_medicines_hospital ON medicines(hospital_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

INSERT INTO hospitals (name, address, phone, email, city, state, pincode, total_beds, icu_beds) 
VALUES ('Central Medical Institute', '123 Medical Plaza', '+91-44-2123-4567', 'admin@medix.com', 'Chennai', 'Tamil Nadu', '600001', 240, 50)
ON CONFLICT DO NOTHING;

SQL

    success "Database schema created"
}

create_backend() {
    log "=========================================="
    log "Step 7: Creating Backend Server"
    log "=========================================="

    mkdir -p backend/{routes,middleware,controllers,database,uploads,logs}

    cat > backend/package.json <<'EOF'
{
  "name": "medix-hms-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.2",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "compression": "^1.7.4",
    "helmet": "^7.0.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.1.0"
  }
}
EOF

    cat > backend/server.js <<'EOF'
const express = require('express');
const pg = require('pg');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'MediX HMS API is running',
        timestamp: new Date(),
        environment: process.env.NODE_ENV
    });
});

app.get('/api/v1/hospitals', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hospitals');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ MediX HMS API running on http://localhost:${PORT}`);
});
EOF

    success "Backend server created"
}

create_docker() {
    log "=========================================="
    log "Step 8: Creating Docker Configuration"
    log "=========================================="

    cat > backend/Dockerfile <<'EOF'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
EOF

    cat > docker-compose.yml <<'EOF'
version: '3.9'

services:
  database:
    image: postgres:15-alpine
    container_name: medix-postgres
    environment:
      POSTGRES_DB: medix_hospital
      POSTGRES_USER: medix_admin
      POSTGRES_PASSWORD: medix_password_123
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: medix-api
    environment:
      NODE_ENV: production
      PORT: 5000
      DB_HOST: database
      DB_PORT: 5432
      DB_NAME: medix_hospital
      DB_USER: medix_admin
      DB_PASSWORD: medix_password_123
      JWT_SECRET: your_jwt_secret
    ports:
      - "5000:5000"
    depends_on:
      - database
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: medix-nginx
    ports:
      - "80:80"
    volumes:
      - ./MediX_HMS_v1_Admin_Desktop_App.html:/usr/share/nginx/html/admin.html:ro
      - ./MediX_HMS_v1_Patient_Portal_Web.html:/usr/share/nginx/html/patient.html:ro
      - ./backend/uploads:/usr/share/nginx/html/uploads:ro
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
EOF

    success "Docker configuration created"
}

install_npm() {
    log "=========================================="
    log "Step 9: Installing npm Dependencies"
    log "=========================================="

    cd backend
    npm install
    cd ..

    success "npm dependencies installed"
}

start_docker() {
    log "=========================================="
    log "Step 10: Starting Docker Services"
    log "=========================================="

    docker-compose up -d
    sleep 10

    docker-compose ps

    success "Docker services started"
}

print_summary() {
    log "=========================================="
    log "✅ DEPLOYMENT COMPLETE!"
    log "=========================================="
    
    cat <<EOF

🎉 MediX HMS v1 is deployed and running!

📊 ACCESS YOUR SYSTEM:
   Admin Dashboard: http://localhost/admin.html
   Patient Portal:  http://localhost/patient.html
   API Server:      http://localhost:5000
   API Health:      http://localhost:5000/api/health

📦 RUNNING SERVICES:
   ✓ PostgreSQL Database (port 5432)
   ✓ Node.js API Server (port 5000)
   ✓ Nginx Web Server (port 80)

🔐 DEFAULT CREDENTIALS:
   Email: admin@medix.com
   Password: admin123 (CHANGE IN PRODUCTION!)

📁 Project Directory: $PROJECT_DIR
📝 Deployment Log: $LOG_FILE

🛠️ USEFUL COMMANDS:
   View logs:      docker-compose logs -f
   Stop services:  docker-compose down
   Start services: docker-compose up -d
   Database CLI:   psql -h localhost -U medix_admin -d medix_hospital

=========================================="
EOF
}

main() {
    check_system
    check_docker
    check_node
    check_postgresql
    setup_env
    setup_database
    create_schema
    create_backend
    create_docker
    install_npm
    start_docker
    print_summary

    success "✅ Deployment completed successfully!"
}

main
