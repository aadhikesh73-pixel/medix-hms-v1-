with open('backend/server.js', 'r') as f:
    s = f.read()

OLD = """function allowedOrigins() {
    const origins = [
        'https://medix-admin.onrender.com',
        'https://medix-patient.onrender.com',
        'https://medix-mobile.on
    ];"""

NEW = """function allowedOrigins() {
    const origins = [
        'https://medix-api-5goh.onrender.com', // ✅ Your frontend URL
        'https://medix-admin.onrender.com',
        'https://medix-patient.onrender.com',
        'https://medix-mobile.onrender.com',
    ];
    return origins;
}"""

if OLD in s:
    s = s.replace(OLD, NEW)
    with open('backend/server.js', 'w') as f:
        f.write(s)
    print("✅ Applied — the app's own domain is now in the CORS whitelist")
else:
    print("❌ Not found — run: grep -n \"function allowedOrigins\" -A 6 backend/server.js   and paste me the output")
