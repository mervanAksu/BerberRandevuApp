const $ = selector => document.querySelector(selector);
const select = $('#salon');
const content = $('#content');
const modal = $('#editor');
const form = $('#editor-form');
const labels = { confirmed: 'Bekliyor', arrived: 'Geldi', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal edildi' };
const transitions = { confirmed: ['arrived', 'completed', 'no_show', 'cancelled'], arrived: ['completed', 'cancelled'] };
const dayFormat = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const lira = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
const asDate = day => new Date(day + 'T12:00:00Z');
const time = minute => [Math.floor(minute / 60), minute % 60].map(n => String(n).padStart(2, '0')).join(':');
const option = (id, name) => '<option value="' + esc(id) + '">' + esc(name) + '</option>';
let day = today();
let dashboard;
let sequence = 0;
let editor;
let busy = false;

async function api(path, data) {
  const options = {cache:'no-store'};
  if (data !== undefined) Object.assign(options, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data),
  });
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || 'İşlem başarısız.');
    error.code = body.code;
    throw error;
  }
  return body;
}
const pathFor = salonId => '/api/salons/' + encodeURIComponent(salonId);
function showLoadError(error, retry) {
  content.innerHTML = '<p class="error" role="alert">' + esc(error.message) + '</p><button>Tekrar dene</button>';
  content.querySelector('button').onclick = retry;
}
async function boot() {
  try {
    const {salons} = await api('/api/salons');
    if (!salons.length) {
      select.innerHTML = option('', 'Salon bulunmuyor');
      content.innerHTML = '<p class="empty">Laboratuvardaki kurgusal salonları oluşturup ajandalarını deneyebilirsiniz.</p><button id="seed" class="primary">Örnek salonları oluştur</button>';
      $('#seed').onclick = async event => {
        event.currentTarget.disabled = true;
        try { await api('/api/bootstrap', {}); await boot(); }
        catch (error) { showLoadError(error, boot); }
      };
      return;
    }
    select.innerHTML = salons.map(s => option(s.id, s.name)).join('');
    select.disabled = false;
    await load();
  } catch (error) { showLoadError(error, boot); }
}
async function load() {
  const generation = ++sequence;
  const id = select.value;
  dashboard = null;
  $('#shop-name').textContent = select.selectedOptions[0]?.textContent || 'İşletme paneli';
  $('#add').hidden = true;
  content.innerHTML = '<p class="empty" role="status">Ajanda yükleniyor…</p>';
  try {
    const result = await api(pathFor(id));
    if (generation !== sequence || id !== select.value) return;
    dashboard = result;
    render();
  } catch (error) { if (generation === sequence) showLoadError(error, load); }
}
function render() {
  const {salon, services, staff, appointments} = dashboard;
  $('#shop-name').textContent = salon.name + ' · ' + salon.location;
  $('#add').hidden = !services.length || !staff.length;
  const rows = appointments.filter(a => a.day === day).sort((a,b) => a.startMinute - b.startMinute || a.staffName.localeCompare(b.staffName,'tr'));
  const count = status => rows.filter(row => row.status === status).length;
  const summary = Object.entries(labels).map(([status, label]) => {
    const n = count(status);
    return n ? n + ' ' + label.toLocaleLowerCase('tr') : '';
  }).filter(Boolean).join(' · ');
  const list = rows.map(a =>
    '<li class="booking"><div class="time">' + time(a.startMinute) + '<small>' + time(a.endMinute) + '</small></div>' +
    '<div><h3>' + esc(a.customerName) + '</h3><p>' + esc(a.serviceName) + ' · ' + esc(a.staffName) + '</p></div>' +
    '<span class="status ' + esc(a.status) + '">' + esc(labels[a.status]) + '</span>' +
    (transitions[a.status] ? '<button class="edit-status" data-id="' + esc(a.id) + '" aria-label="' + esc(a.customerName + ' için durum değiştir') + '">Durum değiştir</button>' : '') + '</li>').join('');
  content.innerHTML = '<section class="agenda" aria-labelledby="agenda-day"><div class="agenda-heading"><h2 id="agenda-day">' + dayFormat.format(asDate(day)) + '</h2>' +
    '<div class="controls"><button class="date-arrow" data-delta="-1" aria-label="Önceki gün">‹</button><input id="date" type="date" min="0001-01-01" max="9999-12-31" aria-label="Ajanda tarihi" value="' + esc(day) + '"><button class="date-arrow" data-delta="1" aria-label="Sonraki gün">›</button><button id="today">Bugün</button></div></div>' +
    '<p class="summary">' + (summary || '0 randevu') + '</p>' +
    (rows.length ? '<ul id="list">' + list + '</ul>' : '<p class="empty">Bu gün için kayıtlı randevu yok.</p>') + '</section>' +
    '<details><summary>Hizmetler (' + services.length + ')</summary><ul>' + services.map(s=>'<li>' + esc(s.name) + ' · ' + s.duration + ' dk · ' + lira.format(s.price) + '</li>').join('') + '</ul></details>' +
    '<details><summary>Çalışanlar (' + staff.length + ')</summary><ul>' + staff.map(s=>'<li>' + esc(s.name) + ' · ' + esc(s.role) + '</li>').join('') + '</ul></details>';
}
function setDate(value, focusSelector) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return;
  day = value;
  render();
  if (focusSelector) $(focusSelector)?.focus();
  $('#announcement').textContent = dayFormat.format(asDate(day));
}
content.addEventListener('change', event => {
  if (event.target.id === 'date' && event.target.validity.valid && event.target.value) setDate(event.target.value, '#date');
});
content.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !dashboard) return;
  if (button.dataset.delta) {
    const date = asDate(day);
    date.setUTCDate(date.getUTCDate() + Number(button.dataset.delta));
    setDate(date.toISOString().slice(0,10), '[data-delta="' + button.dataset.delta + '"]');
  }
  if (button.id === 'today') setDate(today(), '#today');
  if (button.dataset.id) {
    const row = dashboard.appointments.find(a=>a.id === button.dataset.id);
    if (row && transitions[row.status]) openEditor(row);
  }
});
function updateSubmit() {
  const cancel = editor?.row && form.elements.status.value === 'cancelled';
  $('#submit').textContent = cancel ? 'İptali onayla' : editor?.row ? 'Durumu kaydet' : 'Randevu ekle';
  $('#submit').className = cancel ? 'danger' : 'primary';
  const warning = $('#cancel-note');
  if (warning) warning.hidden = !cancel;
}
function openEditor(row) {
  if (!dashboard || busy) return;
  editor = { salonId: dashboard.salon.id, generation:sequence, row };
  $('#dialog-title').textContent = row ? 'Randevu durumu' : 'Yeni örnek randevu';
  $('#context').textContent = row ? [dashboard.salon.name, row.customerName, row.staffName, dayFormat.format(asDate(row.day)),time(row.startMinute)].join(' · ') : dashboard.salon.name;
  $('#feedback').hidden = true;
  if (row) {
    $('#fields').innerHTML = '<label>Yeni durum<select name="status" required><option value="">Durum seçin</option>' +
      transitions[row.status].map(status=>option(status, status === 'cancelled' ? 'Randevuyu iptal et' : labels[status])).join('') +
      '</select></label><p id="cancel-note" hidden>Onayladığınızda bu randevu iptal edilir ve saat yeniden açılır.</p>';
    form.elements.status.onchange = updateSubmit;
  } else {
    $('#fields').innerHTML = '<label>Müşteri adı<input name="customerName" minlength="2" maxlength="80" placeholder="Örnek müşteri" required></label><label>Hizmet<select name="serviceId" required>' +
      dashboard.services.map(s=>option(s.id,s.name)).join('') + '</select></label><label>Çalışan<select name="staffId" required>' +
      dashboard.staff.map(s=>option(s.id,s.name)).join('') + '</select></label><label>Tarih<input name="day" type="date" value="' + esc(day) +
      '" required></label><label>Saat<input name="time" type="time" step="900" required></label>';
  }
  updateSubmit();
  modal.showModal();
}
$('#add').onclick = () => openEditor(null);
$('#dismiss').onclick = () => { if (!busy) modal.close(); };
modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
select.onchange = () => {
  if (modal.open) modal.close();
  $('#announcement').textContent = '';
  load();
};
form.onsubmit = async event => {
  event.preventDefault();
  const state = editor;
  if (busy || !state || state.salonId !== select.value || state.generation !== sequence) return;
  const row = state.row;
  const data = Object.fromEntries(new FormData(form));
  const body = row ? {appointmentId:row.id, status:data.status, expectedStatus:row.status} : data;
  const pendingButton = $('#submit');
  busy = true;
  pendingButton.disabled = true;
  $('#dismiss').disabled = true;
  $('#feedback').hidden = true;
  try {
    await api(pathFor(state.salonId) + (row ? '/status' : '/appointments'), body);
    if (state.generation !== sequence || state.salonId !== select.value) return;
    if (!row) day = data.day;
    modal.close();
    $('#announcement').textContent = row ? 'Randevu durumu kaydedildi.' : 'Randevu eklendi.';
    await load();
    if (select.value === state.salonId) {
      const next = row && content.querySelector('[data-id="' + CSS.escape(row.id) + '"]');
      (next || $('#date'))?.focus();
    }
  } catch (error) {
    if (state.generation !== sequence) return;
    if (row && error.code === 'STATUS_CONFLICT') {
      modal.close();
      $('#announcement').textContent = 'Randevu başka bir işlemle değişti. Ajanda yenilendi.';
      await load();
    } else {
      $('#feedback').textContent = error.message;
      $('#feedback').hidden = false;
    }
  } finally {
    busy = false;
    pendingButton.disabled = false;
    $('#dismiss').disabled = false;
  }
};
boot();
