import re

with open('admin/index.html', 'r') as f:
    h = f.read()

print(f"Starting: {len(h)} chars")

# ══════════════════════════════════════════════════════════
# FIX 1 — CLICKABLE STAT CARDS (Overview page)
# clicking "Total Patients" navigates to patients page etc.
# ══════════════════════════════════════════════════════════
h = h.replace(
    '<div class="sc blue"><div class="sc-ic">👥</div><div class="sc-val" id="ov1">—</div><div class="sc-lbl">Total Patients</div><div class="sc-dl up" id="ov1s">—</div></div>',
    '<div class="sc blue" onclick="pg(\'patients\',null)" style="cursor:pointer" title="View all patients"><div class="sc-ic">👥</div><div class="sc-val" id="ov1">—</div><div class="sc-lbl">Total Patients ↗</div><div class="sc-dl up" id="ov1s">—</div></div>'
)
h = h.replace(
    '<div class="sc red"><div class="sc-ic">🏥</div><div class="sc-val" id="ov2">—</div><div class="sc-lbl">In-Patients</div><div class="sc-dl nt" id="ov2s">—</div></div>',
    '<div class="sc red" onclick="pgFilter(\'patients\',\'ADMITTED\')" style="cursor:pointer" title="View admitted patients"><div class="sc-ic">🏥</div><div class="sc-val" id="ov2">—</div><div class="sc-lbl">In-Patients ↗</div><div class="sc-dl nt" id="ov2s">—</div></div>'
)
h = h.replace(
    '<div class="sc pur"><div class="sc-ic">💊</div><div class="sc-val" id="ov3">—</div><div class="sc-lbl">ICU Patients</div><div class="sc-dl nt" id="ov3s">—</div></div>',
    '<div class="sc pur" onclick="pgFilter(\'patients\',\'ICU\')" style="cursor:pointer" title="View ICU patients"><div class="sc-ic">💊</div><div class="sc-val" id="ov3">—</div><div class="sc-lbl">ICU Patients ↗</div><div class="sc-dl nt" id="ov3s">—</div></div>'
)
h = h.replace(
    '<div class="sc grn"><div class="sc-ic">👨\u200d⚕️</div><div class="sc-val" id="ov4">—</div><div class="sc-lbl">Doctors On Duty</div><div class="sc-dl up" id="ov4s">—</div></div>',
    '<div class="sc grn" onclick="pg(\'doctors\',null)" style="cursor:pointer" title="View doctors"><div class="sc-ic">👨\u200d⚕️</div><div class="sc-val" id="ov4">—</div><div class="sc-lbl">Doctors On Duty ↗</div><div class="sc-dl up" id="ov4s">—</div></div>'
)
h = h.replace(
    '<div class="sc grn"><div class="sc-ic">🛏️</div><div class="sc-val" id="ov5">—</div><div class="sc-lbl">Free Beds</div><div class="sc-dl nt" id="ov5s">—</div></div>',
    '<div class="sc grn" onclick="pg(\'beds\',null)" style="cursor:pointer" title="View bed status"><div class="sc-ic">🛏️</div><div class="sc-val" id="ov5">—</div><div class="sc-lbl">Free Beds ↗</div><div class="sc-dl nt" id="ov5s">—</div></div>'
)
h = h.replace(
    '<div class="sc amb"><div class="sc-ic">📅</div><div class="sc-val" id="ov6">—</div><div class="sc-lbl">Today\'s Apts</div><div class="sc-dl nt">—</div></div>',
    '<div class="sc amb" onclick="pg(\'appts\',null)" style="cursor:pointer" title="View appointments"><div class="sc-ic">📅</div><div class="sc-val" id="ov6">—</div><div class="sc-lbl">Today\'s Apts ↗</div><div class="sc-dl nt">—</div></div>'
)
h = h.replace(
    '<div class="sc amb"><div class="sc-ic">⚠️</div><div class="sc-val" id="ov7">—</div><div class="sc-lbl">Low Stock</div><div class="sc-dl dn">Needs reorder</div></div>',
    '<div class="sc amb" onclick="pg(\'pharmacy\',null)" style="cursor:pointer" title="View pharmacy"><div class="sc-ic">⚠️</div><div class="sc-val" id="ov7">—</div><div class="sc-lbl">Low Stock ↗</div><div class="sc-dl dn">Needs reorder</div></div>'
)
h = h.replace(
    '<div class="sc pnk"><div class="sc-ic">💰</div><div class="sc-val" id="ov8">—</div><div class="sc-lbl">Monthly Revenue</div><div class="sc-dl up">This month</div></div>',
    '<div class="sc pnk" onclick="pg(\'finance\',null)" style="cursor:pointer" title="View finance"><div class="sc-ic">💰</div><div class="sc-val" id="ov8">—</div><div class="sc-lbl">Monthly Revenue ↗</div><div class="sc-dl up">This month</div></div>'
)
print("✅ Fix 1: Clickable stat cards done")

# ══════════════════════════════════════════════════════════
# FIX 2 — PATIENT ROW BUTTONS (richer split buttons)
# ══════════════════════════════════════════════════════════
OLD_PAT_ROW = """<td><div class="sb gho"><button class="mb">View</button><button class="ab" onclick="td('pR${p.id}')">▾</button><div class="sdrop" id="pR${p.id}"><a onclick="cd()">👁 Details</a><a onclick="cd()">✏️ Edit</a><a onclick="cd()">🗑 Deactivate</a></div></div></td>"""
NEW_PAT_ROW = """<td><div class="sb gho"><button class="mb" onclick="viewPatDetail(${p.id})">View</button><button class="ab" onclick="td('pR${p.id}')">▾</button><div class="sdrop" id="pR${p.id}"><a onclick="viewPatDetail(${p.id});cd()">👁 View Details</a><a onclick="editPat(${p.id});cd()">✏️ Edit Patient</a><a onclick="chgPatStatus(${p.id},'ADMITTED');cd()">🏥 Set Admitted</a><a onclick="chgPatStatus(${p.id},'ICU');cd()">💊 Move to ICU</a><a onclick="chgPatStatus(${p.id},'OPD');cd()">🚶 Set OPD</a><a onclick="chgPatStatus(${p.id},'DISCHARGED');cd()">✅ Discharge</a><div class="dv"></div><a onclick="deactPat(${p.id});cd()">🗑 Deactivate</a></div></div></td>"""
h = h.replace(OLD_PAT_ROW, NEW_PAT_ROW)
print("✅ Fix 2: Patient row buttons done")

# ══════════════════════════════════════════════════════════
# FIX 3 — DOCTOR ROW BUTTONS (richer split buttons)
# ══════════════════════════════════════════════════════════
OLD_DOC_ROW = """<div class="sb gho"><button class="mb">Manage</button><button class="ab" onclick="td('dR${doc.id}')">▾</button><div class="sdrop" id="dR${doc.id}"><a onclick="updDocSt(${doc.id},'ACTIVE');cd()">✅ Active</a><a onclick="updDocSt(${doc.id},'ON_CALL');cd()">📞 On Call</a><a onclick="updDocSt(${doc.id},'OFF_DUTY');cd()">🔴 Off Duty</a><div class="dv"></div><a onclick="gQRDoc('${doc.qr_code_id}','${doc.first_name} ${doc.last_name}');cd()">🪪 Generate QR</a></div></div>"""
NEW_DOC_ROW = """<div class="sb gho"><button class="mb" onclick="editDoc(${doc.id})">Manage</button><button class="ab" onclick="td('dR${doc.id}')">▾</button><div class="sdrop" id="dR${doc.id}"><a onclick="editDoc(${doc.id});cd()">✏️ Edit Profile</a><a onclick="viewDocDetail(${doc.id});cd()">👁 View Details</a><div class="dv"></div><a onclick="updDocSt(${doc.id},'ACTIVE');cd()">✅ Set On Duty</a><a onclick="updDocSt(${doc.id},'ON_CALL');cd()">📞 Set On Call</a><a onclick="updDocSt(${doc.id},'OFF_DUTY');cd()">🔴 Set Off Duty</a><a onclick="updDocSt(${doc.id},'BREAK');cd()">☕ Set On Break</a><div class="dv"></div><a onclick="gQRDoc('${doc.qr_code_id}','${doc.first_name} ${doc.last_name}');cd()">🪪 Generate QR</a><a onclick="deactDoc(${doc.id});cd()">🗑 Remove</a></div></div>"""
h = h.replace(OLD_DOC_ROW, NEW_DOC_ROW)
print("✅ Fix 3: Doctor row buttons done")

# ══════════════════════════════════════════════════════════
# FIX 4 — ADD EDIT MODALS before </body>
# ══════════════════════════════════════════════════════════
EDIT_MODALS = """
<!-- Patient Edit Modal -->
<div class="mback" id="patEditM">
  <div class="mbox">
    <div class="mtitle">Edit Patient <span id="patEditId" style="font-size:11px;color:var(--sub)"></span><button class="mclose" onclick="closeM('patEditM')">✕</button></div>
    <input type="hidden" id="peId">
    <div class="g2">
      <div class="mrow"><label>First Name *</label><input id="pefn" placeholder="First name"></div>
      <div class="mrow"><label>Last Name *</label><input id="peln" placeholder="Last name"></div>
    </div>
    <div class="g2">
      <div class="mrow"><label>Phone *</label><input id="peph" placeholder="+91-XXXXX-XXXXX"></div>
      <div class="mrow"><label>Email</label><input id="peem" type="email" placeholder="patient@email.com"></div>
    </div>
    <div class="g2">
      <div class="mrow"><label>Age</label><input id="peage" type="number" placeholder="35"></div>
      <div class="mrow"><label>Gender</label><select id="pegen"><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></div>
    </div>
    <div class="g2">
      <div class="mrow"><label>Blood Group</label><select id="peblood"><option value="">Select</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option></select></div>
      <div class="mrow"><label>Admission Status</label><select id="peadm"><option value="OPD">OPD</option><option value="ADMITTED">Admitted</option><option value="ICU">ICU</option><option value="DISCHARGED">Discharged</option></select></div>
    </div>
    <div class="mrow"><label>Address</label><input id="peaddr" placeholder="Full address"></div>
    <div class="mrow"><label>Medical History</label><textarea id="pehist" placeholder="Known conditions, surgeries..."></textarea></div>
    <div class="mrow"><label>Allergies</label><input id="peallerg" placeholder="e.g. Penicillin"></div>
    <div class="g2">
      <div class="mrow"><label>Emergency Contact Name</label><input id="peecn" placeholder="Contact person"></div>
      <div class="mrow"><label>Emergency Contact Phone</label><input id="peecph" placeholder="+91-XXXXX-XXXXX"></div>
    </div>
    <div class="mact">
      <div class="sb gho"><button class="mb" onclick="closeM('patEditM')">Cancel</button><button class="ab" onclick="td('peCanD')">▾</button><div class="sdrop" id="peCanD"><a onclick="closeM('patEditM');cd()">✕ Close without saving</a></div></div>
      <div class="sb pri"><button class="mb" onclick="savePatEdit()">💾 Update Patient</button><button class="ab" onclick="td('peSavD')">▾</button><div class="sdrop" id="peSavD"><a onclick="savePatEdit();cd()">💾 Save Changes</a><a onclick="closeM('patEditM');cd()">✕ Discard</a></div></div>
    </div>
  </div>
</div>

<!-- Doctor Edit Modal -->
<div class="mback" id="docEditM">
  <div class="mbox">
    <div class="mtitle">Edit Doctor <span id="docEditId" style="font-size:11px;color:var(--sub)"></span><button class="mclose" onclick="closeM('docEditM')">✕</button></div>
    <input type="hidden" id="deId">
    <div class="g2">
      <div class="mrow"><label>First Name *</label><input id="defn" placeholder="First name"></div>
      <div class="mrow"><label>Last Name *</label><input id="deln" placeholder="Last name"></div>
    </div>
    <div class="mrow"><label>Email *</label><input id="deem" type="email" placeholder="doctor@medix.com"></div>
    <div class="g2">
      <div class="mrow"><label>Phone</label><input id="deph" placeholder="+91-98001-23456"></div>
      <div class="mrow"><label>Specialization</label><input id="despec" placeholder="Cardiology"></div>
    </div>
    <div class="g2">
      <div class="mrow"><label>Qualifications</label><input id="dequal" placeholder="MBBS, MD"></div>
      <div class="mrow"><label>Experience (yrs)</label><input id="deexp" type="number" placeholder="10"></div>
    </div>
    <div class="g2">
      <div class="mrow"><label>Shift</label><select id="deshift"><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option><option value="NIGHT">Night</option><option value="ROTATING">Rotating</option></select></div>
      <div class="mrow"><label>Status</label><select id="dests"><option value="ACTIVE">On Duty</option><option value="OFF_DUTY">Off Duty</option><option value="ON_CALL">On Call</option><option value="BREAK">On Break</option></select></div>
    </div>
    <div class="mrow"><label>Department</label><select id="dedept"><option value="">Select...</option></select></div>
    <div class="mact">
      <div class="sb gho"><button class="mb" onclick="closeM('docEditM')">Cancel</button><button class="ab" onclick="td('deCanD')">▾</button><div class="sdrop" id="deCanD"><a onclick="closeM('docEditM');cd()">✕ Discard changes</a></div></div>
      <div class="sb pri"><button class="mb" onclick="saveDocEdit()">💾 Update Doctor</button><button class="ab" onclick="td('deSavD')">▾</button><div class="sdrop" id="deSavD"><a onclick="saveDocEdit();cd()">💾 Save Changes</a><a onclick="closeM('docEditM');cd()">✕ Discard</a></div></div>
    </div>
  </div>
</div>

<!-- Patient Detail Modal -->
<div class="mback" id="patDetailM">
  <div class="mbox">
    <div class="mtitle">Patient Details <button class="mclose" onclick="closeM('patDetailM')">✕</button></div>
    <div id="patDetailBody" style="font-size:13px;color:var(--sub);line-height:1.9">Loading...</div>
    <div class="mact">
      <div class="sb gho"><button class="mb" onclick="closeM('patDetailM')">Close</button><button class="ab" onclick="td('pdActD')">▾</button><div class="sdrop" id="pdActD"><a onclick="editPatFromDetail();cd()">✏️ Edit Patient</a><a onclick="closeM('patDetailM');cd()">✕ Close</a></div></div>
    </div>
  </div>
</div>

<!-- Doctor Detail Modal -->
<div class="mback" id="docDetailM">
  <div class="mbox">
    <div class="mtitle">Doctor Profile <button class="mclose" onclick="closeM('docDetailM')">✕</button></div>
    <div id="docDetailBody" style="font-size:13px;color:var(--sub);line-height:1.9">Loading...</div>
    <div class="mact">
      <div class="sb gho"><button class="mb" onclick="closeM('docDetailM')">Close</button><button class="ab" onclick="td('ddActD')">▾</button><div class="sdrop" id="ddActD"><a onclick="editDocFromDetail();cd()">✏️ Edit Doctor</a><a onclick="closeM('docDetailM');cd()">✕ Close</a></div></div>
    </div>
  </div>
</div>
"""

h = h.replace('<script>', EDIT_MODALS + '\n<script>', 1)
print("✅ Fix 4: Edit modals added")

# ══════════════════════════════════════════════════════════
# FIX 5 — ADD JS FUNCTIONS before closing </script>
# ══════════════════════════════════════════════════════════
NEW_JS = """
// ── Page filter helper ──────────────────────────────
let _pageFilter = null;
function pgFilter(name, filter) {
  _pageFilter = filter;
  pg(name, null);
  // Apply filter after load
  setTimeout(() => {
    if (name === 'patients' && filter) filterPatsByStatus(filter);
  }, 600);
}
function filterPatsByStatus(status) {
  const rows = document.querySelectorAll('#patBody tr');
  let count = 0;
  rows.forEach(row => {
    const statusCell = row.querySelector('td:nth-child(6)');
    if (!statusCell) return;
    if (status === 'all' || statusCell.textContent.trim().toUpperCase().includes(status)) {
      row.style.display = ''; count++;
    } else {
      row.style.display = 'none';
    }
  });
  document.getElementById('patCnt').textContent = `${count} patients (filtered: ${status})`;
}

// ── View Patient Detail ──────────────────────────────
let _currentPatId = null;
async function viewPatDetail(id) {
  _currentPatId = id;
  openM('patDetailM');
  document.getElementById('patDetailBody').innerHTML = '<div style="text-align:center;padding:20px"><div class="spin"></div></div>';
  try {
    const d = await call('/api/v1/patients/' + id);
    const p = d.data;
    document.getElementById('patDetailBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Patient ID</span><div style="color:var(--txt);font-weight:600;margin-top:2px">${p.patient_id_number}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Status</span><div style="margin-top:4px"><span class="b ${adm(p.admission_status)}">${p.admission_status}</span></div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Full Name</span><div style="color:var(--txt);font-weight:600;margin-top:2px">${p.first_name} ${p.last_name}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Age / Gender</span><div style="color:var(--txt);margin-top:2px">${p.age||'—'} / ${p.gender||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Blood Group</span><div style="color:var(--txt);margin-top:2px">${p.blood_group||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Phone</span><div style="color:var(--txt);margin-top:2px">${p.phone}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Email</span><div style="color:var(--txt);margin-top:2px">${p.email||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Attending Doctor</span><div style="color:var(--txt);margin-top:2px">${p.doctor_name||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Bed Number</span><div style="color:var(--txt);margin-top:2px">${p.bed_number||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Registered</span><div style="color:var(--txt);margin-top:2px">${p.created_at?new Date(p.created_at).toLocaleDateString('en-IN'):'—'}</div></div>
      </div>
      <div style="border-top:1px solid var(--bd);padding-top:12px;margin-bottom:10px">
        <div style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Medical History</div>
        <div style="color:var(--txt)">${p.medical_history||'None recorded'}</div>
      </div>
      <div style="border-top:1px solid var(--bd);padding-top:12px;margin-bottom:10px">
        <div style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Allergies</div>
        <div style="color:var(--txt)">${p.allergies||'None recorded'}</div>
      </div>
      ${p.emergency_contact_name ? `<div style="border-top:1px solid var(--bd);padding-top:12px"><div style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Emergency Contact</div><div style="color:var(--txt)">${p.emergency_contact_name} — ${p.emergency_contact_phone||'—'}</div></div>` : ''}
    `;
  } catch(e) { document.getElementById('patDetailBody').innerHTML = '<div style="color:var(--red)">Failed to load patient details</div>'; }
}
function editPatFromDetail() { if (_currentPatId) { closeM('patDetailM'); editPat(_currentPatId); } }

// ── Edit Patient ─────────────────────────────────────
async function editPat(id) {
  _currentPatId = id;
  openM('patEditM');
  document.getElementById('patEditId').textContent = '— Loading...';
  try {
    const d = await call('/api/v1/patients/' + id);
    const p = d.data;
    document.getElementById('peId').value    = p.id;
    document.getElementById('patEditId').textContent = `— ${p.patient_id_number}`;
    document.getElementById('pefn').value    = p.first_name || '';
    document.getElementById('peln').value    = p.last_name  || '';
    document.getElementById('peph').value    = p.phone      || '';
    document.getElementById('peem').value    = p.email      || '';
    document.getElementById('peage').value   = p.age        || '';
    document.getElementById('pegen').value   = p.gender     || '';
    document.getElementById('peblood').value = p.blood_group|| '';
    document.getElementById('peadm').value   = p.admission_status || 'OPD';
    document.getElementById('peaddr').value  = p.address    || '';
    document.getElementById('pehist').value  = p.medical_history || '';
    document.getElementById('peallerg').value= p.allergies  || '';
    document.getElementById('peecn').value   = p.emergency_contact_name  || '';
    document.getElementById('peecph').value  = p.emergency_contact_phone || '';
  } catch(e) { toast('Failed to load patient: ' + e.message, 'e'); closeM('patEditM'); }
}

async function savePatEdit() {
  const id = document.getElementById('peId').value;
  if (!id) return;
  const body = {
    first_name: g('pefn'), last_name: g('peln'), phone: g('peph'),
    email: g('peem')||null, age: parseInt(g('peage'))||null,
    gender: g('pegen')||null, blood_group: g('peblood')||null,
    address: g('peaddr')||null, medical_history: g('pehist')||null,
    allergies: g('peallerg')||null, admission_status: g('peadm'),
    emergency_contact_name: g('peecn')||null, emergency_contact_phone: g('peecph')||null
  };
  if (!body.first_name || !body.last_name || !body.phone) { toast('First name, last name, phone required','w'); return; }
  try {
    await call('/api/v1/patients/' + id, { method:'PUT', body: JSON.stringify(body) });
    toast('Patient updated ✓','s');
    closeM('patEditM');
    loadPatients();
    loadDash();
  } catch(e) { toast(e.message,'e'); }
}

async function chgPatStatus(id, status) {
  try {
    await call('/api/v1/patients/' + id, { method:'PUT', body: JSON.stringify({ first_name:'_', last_name:'_', phone:'0000000000', admission_status: status }) });
    toast('Patient status → ' + status,'s');
    loadPatients();
  } catch(e) {
    // Fallback: fetch full patient first then update
    try {
      const d = await call('/api/v1/patients/' + id);
      const p = d.data;
      await call('/api/v1/patients/' + id, { method:'PUT', body: JSON.stringify({...p, admission_status: status}) });
      toast('Status → ' + status,'s');
      loadPatients();
    } catch(e2) { toast(e2.message,'e'); }
  }
}

async function deactPat(id) {
  if (!confirm('Deactivate this patient? They will be hidden from active lists.')) return;
  try {
    await call('/api/v1/patients/' + id, { method:'DELETE' });
    toast('Patient deactivated','s');
    loadPatients();
  } catch(e) { toast(e.message,'e'); }
}

// ── View Doctor Detail ───────────────────────────────
let _currentDocId = null;
async function viewDocDetail(id) {
  _currentDocId = id;
  openM('docDetailM');
  document.getElementById('docDetailBody').innerHTML = '<div style="text-align:center;padding:20px"><div class="spin"></div></div>';
  try {
    const d = await call('/api/v1/doctors/' + id);
    const doc = d.data;
    document.getElementById('docDetailBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">QR Code ID</span><div style="color:var(--txt);font-weight:700;margin-top:2px">${doc.qr_code_id||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Status</span><div style="margin-top:4px"><span class="b ${docSt(doc.availability_status)}">${doc.availability_status}</span></div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Full Name</span><div style="color:var(--txt);font-weight:600;margin-top:2px">Dr. ${doc.first_name} ${doc.last_name}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Specialization</span><div style="color:var(--txt);margin-top:2px">${doc.specialization||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Department</span><div style="color:var(--txt);margin-top:2px">${doc.department_name||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Shift</span><div style="color:var(--txt);margin-top:2px">${doc.shift||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Experience</span><div style="color:var(--txt);margin-top:2px">${doc.experience_years||0} years</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Rating</span><div style="color:var(--txt);margin-top:2px">⭐ ${doc.rating||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Email</span><div style="color:var(--txt);margin-top:2px">${doc.email}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Phone</span><div style="color:var(--txt);margin-top:2px">${doc.phone||'—'}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Total Patients</span><div style="color:var(--txt);margin-top:2px">${doc.total_patients||0}</div></div>
        <div><span style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Today's Apts</span><div style="color:var(--txt);margin-top:2px">${doc.today_appointments||0}</div></div>
      </div>
      ${doc.qualifications ? `<div style="border-top:1px solid var(--bd);padding-top:12px"><div style="color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Qualifications</div><div style="color:var(--txt)">${doc.qualifications}</div></div>` : ''}
    `;
  } catch(e) { document.getElementById('docDetailBody').innerHTML = '<div style="color:var(--red)">Failed to load doctor details</div>'; }
}
function editDocFromDetail() { if (_currentDocId) { closeM('docDetailM'); editDoc(_currentDocId); } }

// ── Edit Doctor ───────────────────────────────────────
async function editDoc(id) {
  _currentDocId = id;
  openM('docEditM');
  document.getElementById('docEditId').textContent = '— Loading...';
  try {
    const d = await call('/api/v1/doctors/' + id);
    const doc = d.data;
    document.getElementById('deId').value     = doc.id;
    document.getElementById('docEditId').textContent = `— ${doc.qr_code_id||'DR-'+doc.id}`;
    document.getElementById('defn').value     = doc.first_name    || '';
    document.getElementById('deln').value     = doc.last_name     || '';
    document.getElementById('deem').value     = doc.email         || '';
    document.getElementById('deph').value     = doc.phone         || '';
    document.getElementById('despec').value   = doc.specialization|| '';
    document.getElementById('dequal').value   = doc.qualifications|| '';
    document.getElementById('deexp').value    = doc.experience_years || '';
    document.getElementById('deshift').value  = doc.shift         || 'MORNING';
    document.getElementById('dests').value    = doc.availability_status || 'ACTIVE';
    // populate department
    const depSel = document.getElementById('dedept');
    depSel.innerHTML = '<option value="">Select...</option>';
    try {
      const deps = await call('/api/v1/departments');
      deps.data.forEach(dep => {
        const opt = document.createElement('option');
        opt.value = dep.id; opt.textContent = dep.name;
        if (dep.id === doc.department_id) opt.selected = true;
        depSel.appendChild(opt);
      });
    } catch(e) {}
  } catch(e) { toast('Failed to load doctor: ' + e.message, 'e'); closeM('docEditM'); }
}

async function saveDocEdit() {
  const id = document.getElementById('deId').value;
  if (!id) return;
  const body = {
    first_name: g('defn'), last_name: g('deln'), email: g('deem'),
    phone: g('deph')||null, specialization: g('despec')||null,
    qualifications: g('dequal')||null, experience_years: parseInt(g('deexp'))||0,
    shift: g('deshift'), availability_status: g('dests'),
    department_id: g('dedept')||null
  };
  if (!body.first_name || !body.last_name || !body.email) { toast('First name, last name, email required','w'); return; }
  try {
    await call('/api/v1/doctors/' + id, { method:'PUT', body: JSON.stringify(body) });
    toast('Doctor updated ✓','s');
    closeM('docEditM');
    loadDoctors();
    loadDash();
  } catch(e) { toast(e.message,'e'); }
}

async function deactDoc(id) {
  if (!confirm('Remove this doctor from active staff?')) return;
  try {
    await call('/api/v1/doctors/' + id, { method:'DELETE' });
    toast('Doctor removed','s');
    loadDoctors();
  } catch(e) { toast(e.message,'e'); }
}
"""

# Insert before last </script>
h = h[:h.rfind('</script>')] + NEW_JS + '\n</script>'
print("✅ Fix 5: Edit JS functions added")

with open('admin/index.html', 'w') as f:
    f.write(h)

print(f"Final size: {len(h)} chars")
print("\n✅ All 5 fixes applied!")
