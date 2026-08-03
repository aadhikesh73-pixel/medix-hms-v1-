
with open('admin/index.html', 'r') as f:
    h = f.read()

changed = False

OLD1 = "if(isNaN(ans)||ans!==capAns){document.getElementById('capErr').style.display='block';genCap();return;}"
NEW1 = "if(!ans){document.getElementById('capErr').style.display='block';return;}"
if OLD1 in h:
    h = h.replace(OLD1, NEW1)
    print("✅ [1/2] Removed the broken capAns check")
    changed = True
else:
    print("❌ [1/2] Not found — run: grep -n \"capAns\" admin/index.html   and paste me the output")

OLD2 = "body:JSON.stringify({email,password:pass})"
NEW2 = "body:JSON.stringify({email,password:pass,turnstile_token:turnstileToken,captcha_id:captchaId,captcha_answer:ans})"
if OLD2 in h:
    h = h.replace(OLD2, NEW2)
    print("✅ [2/2] Login request now sends captcha_id/captcha_answer/turnstile_token")
    changed = True
else:
    print("❌ [2/2] Not found — run: grep -n \"body:JSON.stringify({email,password:pass})\" admin/index.html   and paste me the output")

if changed:
    with open('admin/index.html', 'w') as f:
        f.write(h)
    with open('backend/public/index.html', 'w') as f:
        f.write(h)
    print("Saved to admin/index.html and backend/public/index.html")
