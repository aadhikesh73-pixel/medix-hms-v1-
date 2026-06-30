# MediX HMS v1 - Complete REST API Documentation

**Base URL**: `https://api.your-domain.com/v1`
**Version**: 1.0
**Last Updated**: June 2024

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [Error Handling](#error-handling)
4. [Patients API](#patients-api)
5. [Doctors API](#doctors-api)
6. [Beds API](#beds-api)
7. [Appointments API](#appointments-api)
8. [Medicine API](#medicine-api)
9. [Attendance API](#attendance-api)
10. [Orders API](#orders-api)
11. [Finance API](#finance-api)
12. [Notifications API](#notifications-api)

---

## 🔐 Authentication

All API endpoints (except `/auth/login` and `/auth/register`) require JWT authentication.

### Login

**Endpoint**: `POST /auth/login`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@medix.com",
    "password": "SecurePassword123!"
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@medix.com",
    "role": "ADMIN",
    "hospitalId": 1
  }
}
```

### Register

**Endpoint**: `POST /auth/register`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@medix.com",
    "password": "SecurePassword123!",
    "name": "Dr. John Doe",
    "role": "DOCTOR"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": 45,
    "email": "doctor@medix.com",
    "role": "DOCTOR"
  }
}
```

### Logout

**Endpoint**: `POST /auth/logout`

**Headers**:
```
Authorization: Bearer <token>
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## 🚦 Rate Limiting

All endpoints are rate limited:

- **General API**: 10 requests per second per IP
- **Authentication**: 5 login attempts per minute per IP
- **File Upload**: 100 MB per request, 1 GB per hour per user

**Rate Limit Headers**:
```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 599
X-RateLimit-Reset: 1234567890
```

---

## ⚠️ Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "email",
        "message": "Email is required"
      }
    ]
  }
}
```

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Successful GET request |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource already exists |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |
| 503 | Service Unavailable | Database connection failed |

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_CREDENTIALS | 401 | Email or password incorrect |
| TOKEN_EXPIRED | 401 | JWT token has expired |
| UNAUTHORIZED | 401 | Missing authorization header |
| FORBIDDEN | 403 | User doesn't have permission |
| NOT_FOUND | 404 | Resource not found |
| DUPLICATE_EMAIL | 409 | Email already registered |
| DUPLICATE_PHONE | 409 | Phone number already registered |
| VALIDATION_ERROR | 400 | Invalid request data |
| DATABASE_ERROR | 500 | Database connection error |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |

---

## 👥 Patients API

### Get All Patients

**Endpoint**: `GET /patients`

**Headers**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Query Parameters**:
```
page=1
limit=20
search=kumar
status=admitted
department=cardiology
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "patients": [
      {
        "id": 1,
        "patientIdNumber": "P-001234",
        "firstName": "Rajesh",
        "lastName": "Kumar",
        "email": "rajesh@example.com",
        "phone": "+91-98765-43210",
        "age": 45,
        "gender": "M",
        "bloodGroup": "O+",
        "address": "123 Main Street",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "pincode": "600001",
        "emergencyContactName": "Priya Kumar",
        "emergencyContactPhone": "+91-98765-43211",
        "emergencyContactRelation": "Spouse",
        "medicalHistory": "Hypertension, Type 2 Diabetes",
        "allergies": "Penicillin",
        "registrationDate": "2024-01-15T10:30:00Z",
        "isActive": true,
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-06-27T09:42:00Z"
      }
    ],
    "total": 2847,
    "page": 1,
    "limit": 20,
    "pages": 143
  }
}
```

### Get Patient by ID

**Endpoint**: `GET /patients/:id`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "patient": { /* same structure as above */ }
  }
}
```

### Create Patient

**Endpoint**: `POST /patients`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/patients \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Rajesh",
    "lastName": "Kumar",
    "email": "rajesh@example.com",
    "phone": "+91-98765-43210",
    "dateOfBirth": "1979-01-15",
    "gender": "M",
    "bloodGroup": "O+",
    "address": "123 Main Street",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "pincode": "600001",
    "emergencyContactName": "Priya Kumar",
    "emergencyContactPhone": "+91-98765-43211",
    "emergencyContactRelation": "Spouse",
    "medicalHistory": "Hypertension",
    "allergies": "Penicillin"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "patient": {
      "id": 2848,
      "patientIdNumber": "P-002848",
      /* ... full patient object ... */
    }
  }
}
```

### Update Patient

**Endpoint**: `PUT /patients/:id`

**Request**:
```bash
curl -X PUT https://api.your-domain.com/v1/patients/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+91-98765-43220",
    "address": "456 New Street"
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "patient": { /* updated patient object */ }
  }
}
```

### Delete Patient

**Endpoint**: `DELETE /patients/:id`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Patient deleted successfully"
}
```

### Get Patient Medical Records

**Endpoint**: `GET /patients/:id/records`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": 1,
        "type": "BLOOD_TEST",
        "date": "2024-06-23",
        "lab": "Central Diagnostic",
        "fileUrl": "https://api.your-domain.com/uploads/records/blood_test_1.pdf",
        "notes": "All values normal"
      },
      {
        "id": 2,
        "type": "X_RAY",
        "date": "2024-06-20",
        "lab": "Imaging Center",
        "fileUrl": "https://api.your-domain.com/uploads/records/xray_1.pdf",
        "notes": "Clear chest X-ray"
      }
    ]
  }
}
```

---

## 👨‍⚕️ Doctors API

### Get All Doctors

**Endpoint**: `GET /doctors`

**Query Parameters**:
```
page=1
limit=20
department=cardiology
status=active
search=sharma
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "doctors": [
      {
        "id": 1,
        "registrationNumber": "MCI-1234567",
        "firstName": "Rajesh",
        "lastName": "Sharma",
        "email": "rajesh.sharma@medix.com",
        "phone": "+91-98001-23456",
        "specialization": "Cardiology",
        "qualifications": "MBBS, MD (Cardiology)",
        "experienceYears": 15,
        "department": "Cardiology",
        "availabilityStatus": "ACTIVE",
        "bio": "Senior Consultant with 15 years of experience",
        "profilePhotoUrl": "https://api.your-domain.com/uploads/doctors/doctor_1.jpg",
        "licenseVerified": true,
        "qrCodeId": "DOC-0042",
        "createdAt": "2023-01-15T10:30:00Z",
        "updatedAt": "2024-06-27T09:42:00Z"
      }
    ],
    "total": 78,
    "page": 1,
    "limit": 20,
    "pages": 4
  }
}
```

### Add Doctor

**Endpoint**: `POST /doctors`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/doctors \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Rajesh",
    "lastName": "Sharma",
    "email": "rajesh.sharma@medix.com",
    "phone": "+91-98001-23456",
    "specialization": "Cardiology",
    "qualifications": "MBBS, MD (Cardiology)",
    "experienceYears": 15,
    "department": "Cardiology",
    "bio": "Senior Consultant with 15 years of experience"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "doctor": { /* full doctor object */ }
  }
}
```

### Update Doctor Status

**Endpoint**: `PUT /doctors/:id/status`

**Request**:
```bash
curl -X PUT https://api.your-domain.com/v1/doctors/1/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "BREAK"
  }'
```

**Status Options**:
- `ACTIVE` - Currently on duty
- `BREAK` - On break
- `OFF_DUTY` - Off duty
- `ON_CALL` - Available on call

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "doctor": { /* updated doctor object */ }
  }
}
```

---

## 🛏️ Beds API

### Get All Beds

**Endpoint**: `GET /beds`

**Query Parameters**:
```
status=occupied
floor=1
bedType=ICU
search=A102
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "beds": [
      {
        "id": 1,
        "bedNumber": "A-101",
        "floor": 1,
        "roomNumber": "101",
        "bedType": "NORMAL",
        "status": "FREE",
        "currentPatientId": null,
        "assignedDate": null,
        "createdAt": "2023-01-01T00:00:00Z",
        "updatedAt": "2024-06-27T09:42:00Z"
      },
      {
        "id": 2,
        "bedNumber": "A-102",
        "floor": 1,
        "roomNumber": "102",
        "bedType": "NORMAL",
        "status": "OCCUPIED",
        "currentPatientId": 1,
        "currentPatient": {
          "id": 1,
          "patientIdNumber": "P-001234",
          "firstName": "Rajesh",
          "lastName": "Kumar"
        },
        "assignedDate": "2024-06-25T08:00:00Z",
        "createdAt": "2023-01-01T00:00:00Z",
        "updatedAt": "2024-06-27T09:42:00Z"
      }
    ],
    "total": 248,
    "summary": {
      "total": 248,
      "free": 14,
      "occupied": 228,
      "cleaning": 6
    }
  }
}
```

### Update Bed Status

**Endpoint**: `PUT /beds/:id/status`

**Request**:
```bash
curl -X PUT https://api.your-domain.com/v1/beds/1/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "OCCUPIED",
    "patientId": 1
  }'
```

**Status Options**:
- `FREE` - Available
- `OCCUPIED` - Has patient
- `CLEANING` - Being cleaned
- `MAINTENANCE` - Under maintenance

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "bed": { /* updated bed object */ }
  }
}
```

---

## 📅 Appointments API

### Get All Appointments

**Endpoint**: `GET /appointments`

**Query Parameters**:
```
date=2024-06-27
status=scheduled
doctorId=1
patientId=1
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "appointments": [
      {
        "id": 1,
        "appointmentId": "APT-001",
        "patientId": 1,
        "patient": {
          "id": 1,
          "firstName": "Rajesh",
          "lastName": "Kumar",
          "patientIdNumber": "P-001234"
        },
        "doctorId": 1,
        "doctor": {
          "id": 1,
          "firstName": "Rajesh",
          "lastName": "Sharma",
          "specialization": "Cardiology"
        },
        "appointmentDate": "2024-06-27",
        "appointmentTime": "10:30",
        "status": "SCHEDULED",
        "reasonForVisit": "Regular checkup",
        "duration": 30,
        "roomNumber": "102",
        "notes": "Patient reports chest pain occasionally",
        "createdAt": "2024-06-20T14:30:00Z"
      }
    ],
    "total": 500,
    "page": 1,
    "limit": 20,
    "pages": 25
  }
}
```

### Book Appointment

**Endpoint**: `POST /appointments`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/appointments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": 1,
    "doctorId": 1,
    "appointmentDate": "2024-06-30",
    "appointmentTime": "14:00",
    "reasonForVisit": "Follow-up consultation"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "appointment": { /* full appointment object */ }
  }
}
```

### Cancel Appointment

**Endpoint**: `DELETE /appointments/:id`

**Request**:
```bash
curl -X DELETE https://api.your-domain.com/v1/appointments/1 \
  -H "Authorization: Bearer <token>"
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Appointment cancelled successfully"
}
```

---

## 💊 Medicine API

### Get All Medicines

**Endpoint**: `GET /medicines`

**Query Parameters**:
```
status=low_stock
search=paracetamol
page=1
limit=20
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "medicines": [
      {
        "id": 1,
        "medicineName": "Paracetamol 500mg",
        "genericName": "Acetaminophen",
        "strength": "500mg",
        "unitOfMeasurement": "tablets",
        "quantityInStock": 1250,
        "reorderLevel": 100,
        "unitPrice": 5.00,
        "totalValue": 6250.00,
        "manufacturer": "Cipla Ltd",
        "batchNumber": "B2024001",
        "expiryDate": "2025-12-31",
        "storageLocation": "Shelf A1",
        "status": "IN_STOCK",
        "createdAt": "2024-01-15T10:30:00Z"
      },
      {
        "id": 2,
        "medicineName": "Amoxicillin 250mg",
        "genericName": "Amoxicillin Trihydrate",
        "strength": "250mg",
        "unitOfMeasurement": "capsules",
        "quantityInStock": 45,
        "reorderLevel": 100,
        "unitPrice": 12.00,
        "totalValue": 540.00,
        "manufacturer": "Cipla Ltd",
        "batchNumber": "B2024002",
        "expiryDate": "2025-08-15",
        "storageLocation": "Shelf B2",
        "status": "LOW_STOCK",
        "createdAt": "2024-02-20T09:15:00Z"
      }
    ],
    "total": 486,
    "summary": {
      "totalItems": 486,
      "inStock": 472,
      "lowStock": 14,
      "expiringSoon": 8,
      "totalValue": 245000.00
    }
  }
}
```

### Add Medicine

**Endpoint**: `POST /medicines`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/medicines \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "medicineName": "Aspirin 500mg",
    "genericName": "Acetylsalicylic Acid",
    "strength": "500mg",
    "unitOfMeasurement": "tablets",
    "quantity": 500,
    "unitPrice": 8.50,
    "manufacturer": "Bayer",
    "batchNumber": "B2024100",
    "expiryDate": "2026-06-30",
    "storageLocation": "Shelf A3"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "medicine": { /* full medicine object */ }
  }
}
```

---

## 📍 Attendance API

### QR Code Check-In

**Endpoint**: `POST /attendance/check-in`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/attendance/check-in \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "qrCode": "DOC-0042-2024"
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Welcome Dr. Rajesh Sharma! Checked in successfully.",
  "data": {
    "attendance": {
      "id": 1,
      "staffId": 1,
      "staffName": "Dr. Rajesh Sharma",
      "checkInTime": "2024-06-27T08:30:00Z",
      "checkOutTime": null,
      "attendanceDate": "2024-06-27",
      "status": "PRESENT",
      "duration": null
    }
  }
}
```

### QR Code Check-Out

**Endpoint**: `POST /attendance/check-out`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/attendance/check-out \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "qrCode": "DOC-0042-2024"
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Check-out recorded. See you tomorrow!",
  "data": {
    "attendance": {
      "id": 1,
      "staffId": 1,
      "staffName": "Dr. Rajesh Sharma",
      "checkInTime": "2024-06-27T08:30:00Z",
      "checkOutTime": "2024-06-27T17:45:00Z",
      "attendanceDate": "2024-06-27",
      "status": "PRESENT",
      "duration": "09:15"
    }
  }
}
```

### Get Attendance Report

**Endpoint**: `GET /attendance/report`

**Query Parameters**:
```
from=2024-06-01
to=2024-06-30
department=cardiology
status=present
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "report": [
      {
        "staffId": 1,
        "staffName": "Dr. Rajesh Sharma",
        "department": "Cardiology",
        "presentDays": 22,
        "absentDays": 1,
        "lateDays": 2,
        "totalHours": 198,
        "attendancePercentage": 95.7
      }
    ],
    "period": {
      "from": "2024-06-01",
      "to": "2024-06-30",
      "totalWorkingDays": 23
    }
  }
}
```

---

## 📦 Orders API

### Get All Orders

**Endpoint**: `GET /orders`

**Query Parameters**:
```
status=pending
type=medicine
from=2024-06-01
to=2024-06-30
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": 1,
        "orderId": "ORD-001",
        "orderType": "MEDICINE",
        "supplier": {
          "id": 1,
          "name": "MedPharm Pvt Ltd"
        },
        "items": [
          {
            "itemName": "Amoxicillin 250mg",
            "quantity": 500,
            "unitPrice": 12.00,
            "amount": 6000.00
          }
        ],
        "totalAmount": 6000.00,
        "status": "PENDING",
        "orderDate": "2024-06-25T14:30:00Z",
        "expectedDeliveryDate": "2024-06-27",
        "actualDeliveryDate": null,
        "paymentStatus": "UNPAID"
      },
      {
        "id": 2,
        "orderId": "ORD-002",
        "orderType": "OXYGEN",
        "supplier": {
          "id": 2,
          "name": "BOC India"
        },
        "items": [
          {
            "itemName": "Medical O₂ (D-type)",
            "quantity": 30,
            "unitPrice": 1000.00,
            "amount": 30000.00
          }
        ],
        "totalAmount": 30000.00,
        "status": "DISPATCHED",
        "orderDate": "2024-06-24T10:00:00Z",
        "expectedDeliveryDate": "2024-06-26",
        "actualDeliveryDate": null,
        "paymentStatus": "PAID"
      }
    ],
    "total": 48,
    "summary": {
      "totalOrders": 48,
      "totalValue": 407000.00,
      "pending": 7,
      "delivered": 39
    }
  }
}
```

### Create Order

**Endpoint**: `POST /orders`

**Request**:
```bash
curl -X POST https://api.your-domain.com/v1/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderType": "MEDICINE",
    "supplierId": 1,
    "items": [
      {
        "itemName": "Aspirin 500mg",
        "quantity": 200,
        "unitPrice": 8.50
      }
    ],
    "expectedDeliveryDate": "2024-07-05"
  }'
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "order": { /* full order object */ }
  }
}
```

---

## 💰 Finance API

### Get Revenue Report

**Endpoint**: `GET /finance/revenue`

**Query Parameters**:
```
from=2024-06-01
to=2024-06-30
sector=cardiology
groupBy=daily
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "breakdown": [
      {
        "category": "Consultation Fees",
        "amount": 152000.00,
        "count": 380,
        "percentage": 36.2
      },
      {
        "category": "Lab Tests",
        "amount": 95000.00,
        "count": 475,
        "percentage": 22.6
      },
      {
        "category": "Surgery",
        "amount": 130000.00,
        "count": 15,
        "percentage": 30.9
      },
      {
        "category": "Pharmacy",
        "amount": 42000.00,
        "count": 520,
        "percentage": 10.0
      }
    ],
    "summary": {
      "totalRevenue": 419000.00,
      "averagePerDay": 16760.00,
      "period": {
        "from": "2024-06-01",
        "to": "2024-06-30",
        "days": 25
      }
    }
  }
}
```

### Get Expense Report

**Endpoint**: `GET /finance/expenses`

**Query Parameters**:
```
from=2024-06-01
to=2024-06-30
category=salary
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "breakdown": [
      {
        "category": "Salaries",
        "amount": 850000.00,
        "percentage": 50.6
      },
      {
        "category": "Medicines & Supplies",
        "amount": 420000.00,
        "percentage": 25.0
      },
      {
        "category": "Utilities & Maintenance",
        "amount": 210000.00,
        "percentage": 12.5
      },
      {
        "category": "Equipment & Depreciation",
        "amount": 100000.00,
        "percentage": 6.0
      },
      {
        "category": "Insurance & Legal",
        "amount": 50000.00,
        "percentage": 3.0
      }
      {
        "category": "Other",
        "amount": 30000.00,
        "percentage": 1.8
      }
    ],
    "summary": {
      "totalExpense": 1680000.00,
      "monthlyAverage": 168000.00
    }
  }
}
```

---

## 🔔 Notifications API

### Get Notifications

**Endpoint**: `GET /notifications`

**Query Parameters**:
```
unread=true
sector=patient
priority=critical
limit=20
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": 1,
        "type": "CRITICAL",
        "sector": "PATIENT",
        "title": "Patient Critical Alert",
        "message": "Patient P-001236 (Vikram Singh) in ICU-03 showing abnormal vital signs. BP: 90/60. Immediate intervention required.",
        "priority": "CRITICAL",
        "isRead": false,
        "actionUrl": "/patients/1236",
        "createdAt": "2024-06-27T14:32:00Z"
      },
      {
        "id": 2,
        "type": "WARNING",
        "sector": "MEDICINE",
        "title": "O₂ Cylinder Stock Critical",
        "message": "Only 11 units of Medical O₂ (D-type) remaining. Minimum threshold: 20. Order ORD-002 placed, expected delivery: 2024-06-28.",
        "priority": "HIGH",
        "isRead": false,
        "actionUrl": "/medicines/oxygen",
        "createdAt": "2024-06-27T14:25:00Z"
      },
      {
        "id": 3,
        "type": "INFO",
        "sector": "APPOINTMENT",
        "title": "Appointment Scheduled",
        "message": "Appointment scheduled: Rajesh Kumar with Dr. Sharma on 2024-06-30 at 14:00 in Room 102.",
        "priority": "LOW",
        "isRead": true,
        "actionUrl": "/appointments/45",
        "createdAt": "2024-06-27T12:30:00Z"
      }
    ],
    "unreadCount": 2,
    "total": 156
  }
}
```

### Mark Notification as Read

**Endpoint**: `PUT /notifications/:id`

**Request**:
```bash
curl -X PUT https://api.your-domain.com/v1/notifications/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "isRead": true
  }'
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "notification": { /* updated notification */ }
  }
}
```

---

## 📊 Real-Time WebSocket Events

Connect to WebSocket for real-time updates:

```javascript
const socket = io('https://api.your-domain.com', {
  auth: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});

// Listen for events
socket.on('patient:admitted', (data) => {
  console.log('New patient admitted:', data);
});

socket.on('appointment:scheduled', (data) => {
  console.log('New appointment:', data);
});

socket.on('critical:alert', (data) => {
  console.log('Critical alert:', data);
});

socket.on('medicine:low-stock', (data) => {
  console.log('Medicine low stock:', data);
});

socket.on('bed:status-changed', (data) => {
  console.log('Bed status changed:', data);
});
```

---

## 🔄 WebSocket Event Types

| Event | Description | Data |
|-------|-------------|------|
| `patient:admitted` | New patient admitted | Patient object |
| `patient:discharged` | Patient discharged | Patient ID, timestamp |
| `appointment:scheduled` | Appointment booked | Appointment object |
| `appointment:completed` | Appointment completed | Appointment ID, notes |
| `bed:status-changed` | Bed status updated | Bed object, previous status |
| `medicine:low-stock` | Medicine stock low | Medicine object, quantity |
| `critical:alert` | Critical patient alert | Patient ID, alert details |
| `order:delivered` | Order delivered | Order object |
| `staff:checked-in` | Staff checked in | Staff object, timestamp |
| `notification:new` | New notification | Notification object |

---

## 📝 Pagination

All list endpoints support pagination:

**Query Parameters**:
```
page=1          # Current page (default: 1)
limit=20        # Items per page (default: 20, max: 100)
sortBy=createdAt  # Field to sort by
sortOrder=desc  # asc or desc
```

**Response**:
```json
{
  "success": true,
  "data": {
    "items": [ /* ... */ ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2847,
      "pages": 143,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

## 🧪 Testing API Endpoints

### Using cURL

```bash
# Set token
TOKEN="your_jwt_token"

# Get all patients
curl -X GET "https://api.your-domain.com/v1/patients?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Create patient
curl -X POST "https://api.your-domain.com/v1/patients" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Using Postman

1. Import collection from: `https://api.your-domain.com/postman-collection.json`
2. Set authorization token in environment variables
3. Run requests from collection

### Using Swagger/OpenAPI

Access interactive API docs at: `https://api.your-domain.com/api-docs`

---

## 📞 API Support

- **Documentation**: https://api.your-domain.com/docs
- **Status Page**: https://status.your-domain.com
- **Support Email**: api-support@medix.com
- **Emergency Contact**: +91-1800-MEDIX-911

---

**Version**: 1.0 | **Last Updated**: June 2024 | **Status**: Production Ready
