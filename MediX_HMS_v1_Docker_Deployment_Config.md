# MediX HMS v1 - Docker & Deployment Configuration

## Dockerfile (Backend API)

```dockerfile
# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install PostgreSQL client (for backups)
RUN apk add --no-cache postgresql-client

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy application
COPY . .

# Create upload directory
RUN mkdir -p uploads

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "server.js"]
```

## docker-compose.yml (Production Stack)

```yaml
version: '3.9'

services:
  # PostgreSQL Database
  database:
    image: postgres:15-alpine
    container_name: medix-postgres
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_INITDB_ARGS: "-c max_connections=200 -c shared_buffers=256MB"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./database/seeders.sql:/docker-entrypoint-initdb.d/02-seeders.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - medix-network

  # Redis Cache (Optional but recommended)
  redis:
    image: redis:7-alpine
    container_name: medix-redis
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped
    networks:
      - medix-network

  # Node.js Backend API
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
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRY: 7d
      SERVER_URL: ${SERVER_URL}
      EMAIL_SERVICE: ${EMAIL_SERVICE}
      EMAIL_USER: ${EMAIL_USER}
      EMAIL_PASSWORD: ${EMAIL_PASSWORD}
    ports:
      - "5000:5000"
    depends_on:
      database:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./backend/uploads:/app/uploads
      - ./backend/logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
    networks:
      - medix-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # Nginx Reverse Proxy & SSL Termination
  nginx:
    image: nginx:alpine
    container_name: medix-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./admin-desktop-app:/usr/share/nginx/html/admin:ro
      - ./patient-portal:/usr/share/nginx/html/patient:ro
      - ./backend/uploads:/usr/share/nginx/html/uploads:ro
    depends_on:
      - api
    restart: unless-stopped
    networks:
      - medix-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # Backup Service (Daily automated backups)
  backup:
    image: postgres:15-alpine
    container_name: medix-backup
    environment:
      PGPASSWORD: ${DB_PASSWORD}
    volumes:
      - ./backups:/backups
      - ./scripts/backup.sh:/backup.sh:ro
    entrypoint: /bin/sh -c "while true; do /backup.sh; sleep 86400; done"
    depends_on:
      - database
    restart: unless-stopped
    networks:
      - medix-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  medix-network:
    driver: bridge
```

## .env.example (Environment Configuration)

```env
# ========== DATABASE ==========
DB_HOST=database
DB_PORT=5432
DB_NAME=medix_hospital
DB_USER=medix_admin
DB_PASSWORD=ChangeThisSecurePassword123!

# ========== REDIS ==========
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=ChangeThisRedisPassword123!

# ========== SERVER ==========
NODE_ENV=production
PORT=5000
SERVER_URL=https://your-domain.com
SECRET_KEY=your_super_secret_key_min_32_chars_here

# ========== JWT ==========
JWT_SECRET=your_jwt_secret_key_min_32_chars_here
JWT_EXPIRY=7d

# ========== EMAIL SERVICE ==========
EMAIL_SERVICE=gmail
EMAIL_USER=noreply@medix.com
EMAIL_PASSWORD=app_specific_password
EMAIL_FROM="MediX Hospital <noreply@medix.com>"

# ========== AWS S3 (Optional) ==========
AWS_ACCESS_KEY=your_aws_access_key
AWS_SECRET_KEY=your_aws_secret_key
AWS_BUCKET=medix-uploads
AWS_REGION=ap-south-1

# ========== FIREBASE (Optional) ==========
FIREBASE_API_KEY=your_firebase_key
FIREBASE_PROJECT_ID=your_project_id

# ========== LOGGING ==========
LOG_LEVEL=info
LOG_FILE=/app/logs/medix.log

# ========== SESSION ==========
SESSION_SECRET=your_session_secret_key
COOKIE_SECURE=true
COOKIE_HTTPONLY=true

# ========== MONITORING ==========
SENTRY_DSN=your_sentry_dsn_url
DATADOG_API_KEY=your_datadog_key
```

## Nginx Configuration (nginx.conf)

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 2048;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50M;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;

    # HTTP to HTTPS Redirect
    server {
        listen 80;
        server_name your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS Server
    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        # Security Headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;

        # Static Files (Admin App)
        location /admin/ {
            alias /usr/share/nginx/html/admin/;
            try_files $uri $uri/ /admin/index.html;
            expires 1d;
            add_header Cache-Control "public, immutable";
        }

        # Static Files (Patient Portal)
        location /patient/ {
            alias /usr/share/nginx/html/patient/;
            try_files $uri $uri/ /patient/index.html;
            expires 1d;
            add_header Cache-Control "public, immutable";
        }

        # Uploads
        location /uploads/ {
            alias /usr/share/nginx/html/uploads/;
            expires 30d;
            add_header Cache-Control "public, immutable";
        }

        # API Backend
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;
            
            proxy_pass http://api:5000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            
            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # WebSocket Support
        location /socket.io {
            proxy_pass http://api:5000/socket.io;
            proxy_http_version 1.1;
            proxy_buffering off;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "Upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # Health Check
        location /health {
            proxy_pass http://api:5000/api/health;
            access_log off;
        }

        # Root
        location / {
            return 301 /admin/;
        }
    }
}
```

## setup.sh (Automated Setup Script)

```bash
#!/bin/bash

set -e

echo "🚀 MediX HMS v1 - Automated Setup Script"
echo "=========================================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✓ Docker found"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✓ Docker Compose found"

# Create .env file
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env
    
    # Generate secure passwords
    DB_PASS=$(openssl rand -base64 32)
    REDIS_PASS=$(openssl rand -base64 32)
    JWT_SECRET=$(openssl rand -base64 64)
    SESSION_SECRET=$(openssl rand -base64 32)
    
    sed -i "s/ChangeThisSecurePassword123!/$DB_PASS/" .env
    sed -i "s/ChangeThisRedisPassword123!/$REDIS_PASS/" .env
    sed -i "s/your_jwt_secret_key_min_32_chars_here/$JWT_SECRET/" .env
    sed -i "s/your_session_secret_key/$SESSION_SECRET/" .env
    
    echo "✓ .env file created with secure passwords"
else
    echo "✓ .env file already exists"
fi

# Create necessary directories
mkdir -p ./backend/uploads
mkdir -p ./backend/logs
mkdir -p ./backups
mkdir -p ./nginx/ssl

echo "✓ Directories created"

# Create dummy SSL certificates (if not present)
if [ ! -f ./nginx/ssl/fullchain.pem ]; then
    echo ""
    echo "⚠️  No SSL certificates found. Using self-signed certificate."
    echo "   For production: Use Let's Encrypt or your certificate provider."
    
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ./nginx/ssl/privkey.pem \
        -out ./nginx/ssl/fullchain.pem \
        -subj "/C=IN/ST=State/L=City/O=MediX/CN=localhost"
    
    echo "✓ Self-signed certificates created"
fi

echo ""
echo "🐳 Building Docker images..."
docker-compose build --no-cache

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

echo ""
echo "✅ MediX HMS v1 Setup Complete!"
echo ""
echo "📊 Admin Dashboard: http://localhost/admin"
echo "🏥 Patient Portal: http://localhost/patient"
echo "🔌 API Endpoint: http://localhost:5000"
echo ""
echo "📝 Database Connection:"
echo "   Host: localhost:5432"
echo "   User: medix_admin"
echo "   Database: medix_hospital"
echo ""
echo "🔐 Default Admin Credentials:"
echo "   Username: admin@medix.com"
echo "   Password: admin123456 (Change in production!)"
echo ""
echo "📖 For logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 To stop:"
echo "   docker-compose down"
```

## backup.sh (Automated Backup Script)

```bash
#!/bin/bash

BACKUP_DIR="/backups"
DB_USER="$POSTGRES_USER"
DB_NAME="$POSTGRES_DB"
DB_HOST="database"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/medix_${TIMESTAMP}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting database backup..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Perform backup
pg_dump -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Backup completed: $BACKUP_FILE"
    
    # Keep only last 30 days of backups
    find "$BACKUP_DIR" -name "medix_*.sql.gz" -mtime +30 -delete
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Cleaned old backups (>30 days)"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Backup failed!"
    exit 1
fi
```

## Deployment Instructions

### 1. Initial Setup (First Time)

```bash
# Clone or download the project
git clone https://github.com/yourusername/medix-hms.git
cd medix-hms

# Make scripts executable
chmod +x setup.sh
chmod +x scripts/backup.sh

# Run setup script
./setup.sh
```

### 2. Verify Deployment

```bash
# Check all services are running
docker-compose ps

# View logs
docker-compose logs -f

# Test API health
curl http://localhost:5000/api/health

# Test admin dashboard
open http://localhost/admin
```

### 3. Production Deployment (AWS/DigitalOcean)

```bash
# 1. SSH into your server
ssh -i key.pem ubuntu@your_server_ip

# 2. Install Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 3. Clone repository
git clone https://github.com/yourusername/medix-hms.git
cd medix-hms

# 4. Setup SSL with Let's Encrypt
sudo apt install -y certbot
sudo certbot certonly --standalone -d your-domain.com

# 5. Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./nginx/ssl/
sudo chown $USER:$USER ./nginx/ssl/*

# 6. Configure environment
./setup.sh

# 7. Start services
docker-compose up -d

# 8. Verify
docker-compose ps
curl https://your-domain.com/health
```

### 4. Monitor & Maintain

```bash
# View real-time logs
docker-compose logs -f api

# Check disk space
docker system df

# Clean up unused images
docker image prune -a

# Backup database manually
docker-compose exec database pg_dump -U medix_admin medix_hospital | gzip > backup_manual.sql.gz

# Restore from backup
gunzip < backup_manual.sql.gz | docker-compose exec -T database psql -U medix_admin medix_hospital
```

### 5. SSL Certificate Renewal

```bash
# Renewal happens automatically (30 days before expiry)
# Manual renewal:
sudo certbot renew

# Copy renewed certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./nginx/ssl/

# Reload Nginx
docker-compose exec nginx nginx -s reload
```

---

## Troubleshooting

### Service won't start
```bash
# Check logs
docker-compose logs api

# Verify database is running
docker-compose exec database pg_isready

# Check port conflicts
lsof -i :5000
```

### Database connection error
```bash
# Verify database credentials in .env
cat .env | grep DB_

# Test connection
docker-compose exec database psql -U medix_admin -d medix_hospital -c "SELECT 1;"
```

### High memory usage
```bash
# Check resource usage
docker stats

# Limit container memory
# Edit docker-compose.yml and add:
# deploy:
#   resources:
#     limits:
#       memory: 2G
```

---

## Performance Tuning

### Database Optimization

```sql
-- Create indexes for frequently queried fields
CREATE INDEX idx_patients_hospital ON patients(hospital_id);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
CREATE INDEX idx_invoices_patient ON invoices(patient_id);

-- Analyze query plans
EXPLAIN ANALYZE SELECT * FROM patients WHERE hospital_id = 1;
```

### Application Performance

```javascript
// Enable compression in Express
const compression = require('compression');
app.use(compression());

// Use Redis for caching
const redis = require('redis');
const client = redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
});
```

---

**Version**: 1.0
**Last Updated**: June 2024
**Maintained By**: MediX DevOps Team
