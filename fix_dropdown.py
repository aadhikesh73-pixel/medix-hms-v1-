with open('admin/index.html', 'r') as f:
    h = f.read()

OLD = "function td(id){\n  const el=document.getElementById(id);\n  const was=el.classList.contains('on');\n  cd();\n  if(!was){\n    const src=event&&event.target;\n    const btn=src&&(src.closest('.ab')||src.closest('.mb')||src.closest('.sb'));\n    if(btn){\n      const r=btn.getBoundingClientRect();\n      let t=r.bottom+6;\n      let ri=window.innerWidth-r.right;\n      if(t+280>window.innerHeight) t=r.top-286;\n      if(ri<10) ri=10;\n      el.style.top=t+'px';\n      el.style.right=ri+'px';\n      el.style.left='auto';\n    }\n    el.classList.add('on');\n  }\n}\nfunction cd(){document.querySelectorAll('.sdrop.on').forEach(e=>{e.classList.remove('on');e.style.top='';e.style.right='';e.style.left='';});}\n"

NEW = "function td(id){\n  const el=document.getElementById(id);\n  const was=el.classList.contains('on');\n  cd();\n  if(!was){\n    if(el.parentElement!==document.body) document.body.appendChild(el);\n    const src=event&&event.target;\n    const btn=src&&(src.closest('.ab')||src.closest('.mb')||src.closest('.sb'));\n    if(btn){\n      const r=btn.getBoundingClientRect();\n      let t=r.bottom+6;\n      let ri=window.innerWidth-r.right;\n      if(t+300>window.innerHeight) t=r.top-306;\n      if(ri<10) ri=10;\n      el.style.position='fixed';\n      el.style.top=t+'px';\n      el.style.right=ri+'px';\n      el.style.left='auto';\n      el.style.zIndex='999999';\n    }\n    el.classList.add('on');\n  }\n}\nfunction cd(){document.querySelectorAll('.sdrop.on').forEach(e=>{e.classList.remove('on');});\n}\n"

if OLD in h:
    h = h.replace(OLD, NEW)
    with open('admin/index.html', 'w') as f:
        f.write(h)
    print("SUCCESS: Portal fix applied!")
    print("VERIFY:", "parentElement!==document.body" in h)
else:
    print("FAILED: pattern not found")
