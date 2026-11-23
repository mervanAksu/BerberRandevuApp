const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modal-content');
const logout = document.querySelector('#logout');
let catalog, agenda, date, filter = '', loggedIn = false, loadSequence = 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY', maximumFractionDigits:0}).format(value || 0);
const nameOf = id => catalog?.barbers.find(b => b.id === id)?.name || id;
const servicesOf = ids => (ids || []).map(id => catalog?.services.find(s => s.id === id)?.name || id).join(', ');
const labelDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('tr-TR', {day:'numeric',month:'long',weekday:'long',timeZone:'UTC'});
function shiftDate(value, offset) { const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0,10); }
async function request(path, payload) {
  const response = await fetch(path, {cache:'no-store', ...(payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {})});
  let body; try { body = await response.json(); } catch { throw new Error('Sunucudan yanıt alınamadı. Tekrar deneyin.'); }
  if (!response.ok) { const error = new Error(body.error || 'İşlem tamamlanamadı. Tekrar deneyin.'); error.status = response.status; error.code = body.code; throw error; }
  return body;
}
function notify(message) { const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 3500); }
function showError(target, message) { target.innerHTML = `<div class="error" role="alert">${esc(message)}</div>`; }
function login(message = '') {
  loadSequence++; loggedIn = false; agenda = null; logout.hidden = true;
  app.innerHTML = `<section class="login"><p class="eyebrow">İŞLETME PANELİ</p><h1>İşletme <em>girişi.</em></h1><p class="sub">Günlük randevularınızı yönetmek için işletme şifrenizle giriş yapın.</p><form id="login-form"><label class="field"><span>İşletme şifresi</span><input name="password" type="password" autocomplete="current-password" required autofocus></label><div id="login-error"></div><button class="primary" type="submit">Giriş yap</button></form></section>`;
  if (message) showError(document.querySelector('#login-error'), message);
  document.querySelector('#login-form').addEventListener('submit', async e => { e.preventDefault(); const btn = e.submitter; btn.disabled = true; try { await request('/api/owner/login', {password:new FormData(e.target).get('password')}); loggedIn = true; await load(); } catch(error) { showError(document.querySelector('#login-error'), error.message); } finally { btn.disabled = false; } });
}
function showAccessPrompt(error) {
  if (error.code === 'OWNER_SIGN_IN' || error.code === 'OWNER_FORBIDDEN') {
    loadSequence++;
    loggedIn = false;
    agenda = null;
    logout.hidden = true;
    if (modal.open) modal.close();
    const wrongAccount = error.code === 'OWNER_FORBIDDEN';
    const href = wrongAccount
      ? '/signout-with-chatgpt?return_to=%2Fisletme'
      : '/signin-with-chatgpt?return_to=%2Fisletme';
    app.innerHTML = `<section class="login"><p class="eyebrow">İŞLETME PANELİ</p>
      <h1>İşletme <em>girişi.</em></h1><p class="sub">${esc(error.message)}</p>
      <a class="primary owner-signin" href="${href}" target="_top">${wrongAccount ? 'Hesabı değiştir' : 'ChatGPT ile giriş yap'}</a></section>`;
    return true;
  }
  if (error.status === 401) {
    if (modal.open) modal.close();
    login();
    return true;
  }
  return false;
}
async function load() {
  const sequence = ++loadSequence;
  try { if (!catalog) catalog = await request('/api/catalog'); if (sequence !== loadSequence) return; if (!date) date = catalog.today; const requestedDate = date; const result = await request('/api/owner/agenda?date=' + encodeURIComponent(requestedDate)); if (sequence !== loadSequence) return; agenda = result; date = requestedDate; loggedIn = true; logout.hidden = agenda.authMode === 'platform'; render(); }
  catch(error) { if (sequence !== loadSequence) return; if (showAccessPrompt(error)) return; if (!loggedIn) { app.innerHTML = `<div class="login"><h1>Panele ulaşılamadı.</h1><p class="sub">${esc(error.message)}</p><button class="primary" id="retry">Tekrar dene</button></div>`; document.querySelector('#retry').onclick = load; } else { date = agenda.date; render(); notify(error.message + ' Tekrar deneyin.'); } }
}
function render() {
  const bookings = agenda.bookings.filter(b => !filter || b.barberId === filter);
  const blocks = agenda.blocks.filter(b => !filter || b.barberId === filter);
  const entries = [...bookings.map(b => ({...b, type:'booking'})), ...blocks.map(b => ({...b,type:'block'}))].sort((a,b) => a.time.localeCompare(b.time));
  app.innerHTML = `<section class="intro"><div><p class="eyebrow">MAKAS · MODA</p><h1>Salon <em>ajandası.</em></h1><p class="sub">${esc(labelDate(agenda.date))}</p></div><div class="actions"><button class="secondary add-block"><span class="plus">＋</span>Çalışma arası</button><button class="primary add-walkin"><span class="plus">＋</span>Gelen müşteri</button></div></section>
  <div class="dashboard"><section class="agenda" aria-labelledby="agenda-title"><div class="agenda-head"><div class="agenda-title-row"><h2 id="agenda-title">Randevu defteri</h2><div class="date-nav"><button type="button" id="prev" aria-label="Önceki gün">‹</button><input type="date" id="date" aria-label="Tarih seç" value="${esc(date)}"><button type="button" id="next" aria-label="Sonraki gün">›</button></div></div><div class="filters" aria-label="Berbere göre filtrele"><button class="filter ${!filter?'active':''}" data-filter="" aria-pressed="${!filter}">Tümü</button>${catalog.barbers.map(b=>`<button class="filter ${filter===b.id?'active':''}" data-filter="${esc(b.id)}" aria-pressed="${filter===b.id}">${esc(b.name)}</button>`).join('')}</div></div><div class="count-line">${esc(labelDate(date))} · ${bookings.length} RANDEVU</div><div class="entries">${entries.length ? entries.map(entryHtml).join('') : `<div class="empty"><div class="empty-icon">✳</div><h3>Bu gün için kayıt yok.</h3><p>Yeni bir müşteri ekleyerek başlayabilirsiniz.</p></div>`}</div></section>
  <aside class="side"><div class="side-card dark"><p class="side-label">GÜNLÜK ÖZET</p><strong>${bookings.length.toString().padStart(2,'0')}</strong><p class="caption">${filter ? esc(nameOf(filter))+' için' : 'Bu gün'} randevu</p></div><div class="side-card"><p class="side-label">RANDEVULARIN TUTARI</p><h3>${esc(money(bookings.reduce((total, item) => total + item.price, 0)))}</h3><p>Seçili gündeki aktif randevuların toplamı.</p></div></aside></div><div class="mobile-actions"><button class="secondary add-block"><span class="plus">＋</span>Çalışma arası</button><button class="primary add-walkin"><span class="plus">＋</span>Gelen müşteri</button></div>`;
  document.querySelector('#prev').onclick = () => {date=shiftDate(date,-1);load();}; document.querySelector('#next').onclick = () => {date=shiftDate(date,1);load();};
  document.querySelector('#date').onchange = e => {if(e.target.value){date=e.target.value;load();}};
  document.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => {filter=el.dataset.filter;render();});
  document.querySelectorAll('.add-walkin').forEach(el => el.onclick = walkinDialog);
  document.querySelectorAll('.add-block').forEach(el => el.onclick = blockDialog);
  document.querySelectorAll('[data-cancel]').forEach(el => el.onclick = () => cancelDialog(el.dataset.cancel));
  document.querySelectorAll('[data-unblock]').forEach(el => el.onclick = () => unblockDialog(el.dataset.unblock));
}
function entryHtml(item) {
  if(item.type === 'block') return `<article class="entry block"><div class="entry-time">${esc(item.time)}<small>${esc(item.endTime)}</small></div><div class="entry-body"><h3>${esc(item.reason || 'Çalışma arası')}</h3><p>${esc(nameOf(item.barberId))} · Müsait değil</p></div><button class="entry-action" data-unblock="${esc(item.id)}">Kaldır</button></article>`;
  return `<article class="entry"><div class="entry-time">${esc(item.time)}<small>${esc(item.endTime)}</small></div><div class="entry-body"><h3>${esc(item.name || 'Gelen müşteri')}${item.walkIn?'<span class="tag">GELEN</span>':''}</h3><p>${esc(servicesOf(item.serviceIds))} · ${esc(nameOf(item.barberId))}</p><p class="meta">${item.phone ? esc(item.phone)+' · ' : ''}${esc(money(item.price))} · ${esc(item.reference)}</p></div><button class="entry-action" data-cancel="${esc(item.reference)}">İptal et</button></article>`;
}
function openModal(title, intro, content) { modalContent.innerHTML = `<div class="modal-inner"><div class="modal-top"><h2 id="modal-title">${title}</h2><button class="close" type="button" aria-label="Kapat">×</button></div><p class="modal-intro">${intro}</p>${content}</div>`; modalContent.querySelector('.close').onclick = () => modal.close(); modal.showModal(); }
const barberOptions = () => catalog.barbers.map(b => `<option value="${esc(b.id)}" ${filter===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
function wireForm(handler) { const form=modal.querySelector('form'); let busy = false; form.addEventListener('submit', async e => { e.preventDefault(); if (busy) return; busy = true; const btn=e.submitter || form.querySelector('[type=submit]'); btn.disabled=true; try {await handler(new FormData(form)); modal.close(); await load(); notify('İşlem tamamlandı.');} catch(error) {if(!showAccessPrompt(error)) showError(modal.querySelector('.form-error'),error.message);} finally {busy=false; btn.disabled=false;} }); }
function walkinDialog() {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Istanbul', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === 'hour').value), minute = Number(parts.find(p => p.type === 'minute').value);
  const suggestedTime = date === catalog.today ? String(hour).padStart(2,'0') + ':' + String(Math.floor(minute / 15) * 15).padStart(2,'0') : '10:00';
  openModal('Gelen müşteri', 'Salona gelen müşteriyi uygun bir saate ekleyin.', `<form><span class="field-label">Hizmetler</span><div class="check-list">${catalog.services.map(s=>`<label><input type="checkbox" name="serviceIds" value="${esc(s.id)}">${esc(s.name)} <span>${s.duration} dk · ${esc(money(s.price))}</span></label>`).join('')}</div><label class="field"><span>Berber</span><select name="barberId" required>${barberOptions()}</select></label><div class="form-grid"><label class="field"><span>Tarih</span><input name="date" type="date" value="${esc(date)}" required></label><label class="field"><span>Saat</span><input name="time" type="time" step="900" value="${esc(suggestedTime)}" required></label></div><div class="form-grid"><label class="field"><span>İsim (isteğe bağlı)</span><input name="name" maxlength="100"></label><label class="field"><span>Telefon (isteğe bağlı)</span><input name="phone" type="tel" maxlength="30"></label></div><div class="form-error"></div><div class="modal-actions"><button class="primary" type="submit">Müşteriyi ekle</button></div></form>`);
  const select = modal.querySelector('select[name=barberId]');
  function updateBarbers() {
    const ids = [...modal.querySelectorAll('input[name=serviceIds]:checked')].map(el => el.value);
    [...select.options].forEach(option => { const barber = catalog.barbers.find(b => b.id === option.value); option.disabled = !ids.every(id => barber.serviceIds.includes(id)); });
    if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find(option => !option.disabled)?.value || '';
  }
  modal.querySelectorAll('input[name=serviceIds]').forEach(input => input.addEventListener('change', updateBarbers));
  const requestId = crypto.randomUUID(); wireForm(data => {const serviceIds=data.getAll('serviceIds'); if(!serviceIds.length) throw new Error('En az bir hizmet seçin.'); if (!data.get('barberId')) throw new Error('Seçilen hizmetlerin tümünü sunan bir berber bulunamadı.'); return request('/api/owner/walk-ins', {requestId,serviceIds,barberId:data.get('barberId'),date:data.get('date'),time:data.get('time'),name:data.get('name'),phone:data.get('phone')});});
}
function blockDialog() { openModal('Çalışma arası', 'Mola veya kapalı olduğunuz saatleri takvimde ayırın.', `<form><label class="field"><span>Berber</span><select name="barberId" required>${barberOptions()}</select></label><label class="field"><span>Tarih</span><input type="date" name="date" value="${esc(date)}" required></label><div class="form-grid"><label class="field"><span>Başlangıç</span><input type="time" name="time" step="900" required></label><label class="field"><span>Bitiş</span><input type="time" name="endTime" step="900" required></label></div><p class="hint">Saatleri 15 dakikalık aralıklarla seçin.</p><label class="field"><span>Not (isteğe bağlı)</span><input name="reason" maxlength="120" placeholder="Örn. Öğle arası"></label><div class="form-error"></div><div class="modal-actions"><button class="primary" type="submit">Arayı ekle</button></div></form>`); wireForm(data => request('/api/owner/blocks', Object.fromEntries(data))); }
function cancelDialog(reference) { openModal('Randevuyu iptal et', `Bu randevuyu iptal etmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`, `<form><p class="hint">Randevu kodu: ${esc(reference)}</p><div class="form-error"></div><div class="modal-actions"><button type="button" class="secondary dismiss">Vazgeç</button><button type="submit" class="danger">Randevuyu iptal et</button></div></form>`); modal.querySelector('.dismiss').onclick=()=>modal.close(); wireForm(()=>request('/api/owner/cancel',{reference})); }
function unblockDialog(id) { openModal('Arayı kaldır', 'Bu saatleri yeniden randevuya açmak istiyor musunuz?', `<form><div class="form-error"></div><div class="modal-actions"><button type="button" class="secondary dismiss">Vazgeç</button><button type="submit" class="primary">Arayı kaldır</button></div></form>`); modal.querySelector('.dismiss').onclick=()=>modal.close(); wireForm(()=>request('/api/owner/unblock',{id})); }
logout.onclick = async () => { try {await request('/api/owner/logout', {}); login();} catch(error){notify(error.message);} };
load();
