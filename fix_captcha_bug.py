with open('backend/server.js', 'r') as f:
    s = f.read()

OLD = """            const turnstileResult = await verifyTurnstile(turnstileToken, req.ip);
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
            }"""

NEW = """            const turnstileResult = await verifyTurnstile(turnstileToken, req.ip);
            if (turnstileResult !== true) {
                // Not explicitly passed by Turnstile (no token sent, Turnstile not
                // configured, or verification failed) — fall back to word CAPTCHA.
                // verifyTurnstile() returns false (not null) when no token is present
                // at all, which is the normal case right now — must not hard-reject.
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
            }"""

if OLD in s:
    s = s.replace(OLD, NEW)
    with open('backend/server.js', 'w') as f:
        f.write(s)
    print("✅ Applied — the login-blocking bug is fixed")
else:
    print("❌ Pattern not found — paste me: sed -n '725,750p' backend/server.js")
