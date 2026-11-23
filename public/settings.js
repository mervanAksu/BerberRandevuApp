const sections = [
  ['shop', 'Salon bilgileri'],
  ['services', 'Hizmetler'],
  ['staff', 'Çalışanlar'],
  ['hours', 'Çalışma saatleri'],
];
const week = [
  [1, 'Pazartesi'], [2, 'Salı'], [3, 'Çarşamba'], [4, 'Perşembe'],
  [5, 'Cuma'], [6, 'Cumartesi'], [0, 'Pazar'],
];
const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const isActive = item => item.active !== false;
const hourLabel = minutes => [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, '0')).join(':');
const toMinutes = value => {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
};

export async function openSettings({ app, modal, modalContent, request, notify, esc, showAccessPrompt, active, onSave }) {
  const endpoint = '/api/owner/settings';
  let profile, revision;
  let section = 'shop';
  let staffId = '';

  const field = (label, name, value, attributes = '') =>
    `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${attributes}></label>`;
  const toggle = (name, checked, label, value = '') =>
    `<label class="setting-check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  const status = item => isActive(item) ? '' : '<span class="inactive-label">Pasif</span>';
  const summary = (label, value) => `<div><dt>${label}</dt><dd>${esc(value || 'Girilmedi')}</dd></div>`;
  const editButton = (type, id, label) =>
    `<button class="settings-edit" data-edit="${type}" data-id="${esc(id)}" aria-label="${esc(label)}">Düzenle</button>`;

  async function refresh() {
    app.innerHTML = '<p class="loading" role="status">Salon ayarları yükleniyor…</p>';
    try {
      const result = await request(endpoint);
      if (!active()) return;
      ({ profile, revision } = result);
      render();
    } catch (error) {
      if (!active() || showAccessPrompt(error)) return;
      app.innerHTML = `<div class="login"><h1>Ayarlar yüklenemedi.</h1><div class="error" role="alert">${esc(error.message)}</div><button class="primary" id="reload-settings">Tekrar dene</button></div>`;
      app.querySelector('#reload-settings').onclick = refresh;
    }
  }

  function listMarkup(items, type) {
    if (!items.length) return `<p class="settings-empty">Henüz ${type === 'services' ? 'hizmet' : 'çalışan'} eklenmedi.</p>`;
    return `<ul class="settings-list">${items.map(item => {
      const detail = type === 'services'
        ? [item.category, `${item.duration} dk`, tl.format(item.price)].filter(Boolean).join(' · ')
        : [item.title, `${profile.services.filter(s => isActive(s) && item.serviceIds.includes(s.id)).length} hizmet`].filter(Boolean).join(' · ');
      return `<li><div><h3>${esc(item.name)} ${status(item)}</h3><p>${esc(detail)}</p></div>${editButton(type, item.id, item.name + ' düzenle')}</li>`;
    }).join('')}</ul>`;
  }

  function hoursMarkup() {
    const staff = profile.barbers.filter(isActive);
    const worker = staff.find(b => b.id === staffId) || staff[0];
    if (!worker) return '<p class="settings-empty">Çalışma saatlerini tanımlamak için önce aktif bir çalışan ekleyin.</p>';
    staffId = worker.id;
    return `<label class="field staff-picker"><span>Çalışan</span><select id="hours-staff">${staff.map(b =>
      `<option value="${esc(b.id)}" ${b.id === staffId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <dl class="settings-summary">${week.map(([key, label]) => summary(label,
        (worker.shifts[key] || []).map(([start, end]) => hourLabel(start) + ' – ' + hourLabel(end)).join(' / ') || 'Kapalı')).join('')}</dl>`;
  }

  function render() {
    const heading = sections.find(([key]) => key === section)[1];
    let action = '', body;
    if (section === 'shop') {
      action = editButton('shop', '', 'Salon bilgilerini düzenle');
      const shop = profile.shop;
      body = `<dl class="settings-summary">${summary('Salon adı', shop.name)}${summary('Konum', shop.location)}
        ${summary('Tanıtım', shop.description)}${summary('Örnek salon uyarısı', shop.isDemo ? 'Açık' : 'Kapalı')}</dl>`;
    } else if (section === 'hours') {
      body = hoursMarkup();
      if (profile.barbers.some(isActive)) action = editButton('hours', staffId, 'Haftalık çalışma saatlerini düzenle');
    } else {
      const services = section === 'services';
      action = `<button class="primary" data-edit="${section}">${services ? 'Hizmet ekle' : 'Çalışan ekle'}</button>`;
      body = listMarkup(services ? profile.services : profile.barbers, section);
    }
    app.innerHTML = `<section class="intro settings-intro"><div><p class="eyebrow">${esc(profile.shop.name)}</p><h1>Salon <em>ayarları.</em></h1></div></section>
      <div class="settings-layout"><nav class="settings-sections" aria-label="Ayar bölümleri">${sections.map(([key, label]) =>
        `<button type="button" data-section="${key}" ${key === section ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
      <section class="settings-card" aria-labelledby="settings-title"><header><h2 id="settings-title">${heading}</h2>${action}</header>${body}</section></div>`;
    app.querySelectorAll('[data-section]').forEach(button => {
      button.onclick = () => { section = button.dataset.section; render(); app.querySelector('[aria-current="page"][data-section]').focus(); };
    });
    app.querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => edit(button.dataset.edit, button.dataset.id);
    });
    const selector = app.querySelector('#hours-staff');
    if (selector) selector.onchange = () => { staffId = selector.value; render(); app.querySelector('#hours-staff').focus(); };
  }

  function shopFields(shop) {
    return `${field('Salon adı', 'name', shop.name, 'required maxlength="80"')}
      ${field('Konum', 'location', shop.location, 'required maxlength="160"')}
      <label class="field"><span>Salon tanıtımı</span><textarea name="description" rows="3" maxlength="600">${esc(shop.description)}</textarea></label>
      ${toggle('isDemo', shop.isDemo, 'Müşterilere örnek salon uyarısı göster')}
      <details class="asset-settings"><summary>Salon görselleri</summary><p class="modal-intro">Kuruluma eklenmiş görsellerin dosya yollarını kullanın.</p>
      ${field('Logo dosyası', 'logoPath', shop.logoPath, 'required')}
      ${field('Salon fotoğrafı dosyası', 'imagePath', shop.imagePath, 'required')}
      ${field('Fotoğraf açıklaması', 'imageAlt', shop.imageAlt, 'maxlength="160"')}</details>`;
  }

  function serviceFields(item) {
    return `${field('Hizmet adı', 'name', item.name, 'required maxlength="80"')}
      <div class="form-grid">${field('Ücret (TL)', 'price', item.price, 'type="number" min="0" max="1000000" step="1" required')}
      ${field('Süre (dakika)', 'duration', item.duration, 'type="number" min="15" max="1440" step="15" required')}</div>
      ${field('Kategori', 'category', item.category, 'maxlength="40"')}
      <label class="field"><span>Hizmet açıklaması</span><textarea name="description" rows="2" maxlength="300">${esc(item.description)}</textarea></label>
      <fieldset class="settings-options"><legend>Hizmeti veren çalışanlar</legend>
      ${profile.barbers.filter(isActive).map(b => toggle('assigned', b.serviceIds.includes(item.id), b.name, b.id)).join('') || '<p class="hint">Çalışan eklediğinizde hizmetlerini seçebilirsiniz.</p>'}</fieldset>
      ${toggle('active', isActive(item), 'Hizmet yeni randevulara açık')}`;
  }

  function workerFields(item) {
    return `${field('Çalışanın adı', 'name', item.name, 'required maxlength="80"')}
      ${field('Unvan', 'title', item.title, 'maxlength="80"')}
      <fieldset class="settings-options"><legend>Sunduğu hizmetler</legend>
      ${profile.services.filter(isActive).map(s => toggle('serviceIds', item.serviceIds.includes(s.id), s.name, s.id)).join('') || '<p class="hint">Hizmet eklediğinizde çalışan atayabilirsiniz.</p>'}</fieldset>
      ${toggle('active', isActive(item), 'Çalışan yeni randevulara açık')}`;
  }

  function intervalRow(start, end) {
    return `<div class="interval-row">${field('Başlangıç', 'start', hourLabel(start), 'type="time" step="900" required')}
      ${field('Bitiş', 'end', hourLabel(end === 1440 ? 0 : end), 'type="time" step="900" required')}
      <button type="button" class="remove-interval" aria-label="Bu çalışma aralığını kaldır">Kaldır</button></div>`;
  }

  function workweekFields(worker) {
    return `<p class="modal-intro">${esc(worker.name)} için haftalık çalışma aralıklarını girin. Mola için günü iki aralığa bölün. Bitiş saati 00:00, gün sonunu belirtir.</p>
      ${week.map(([key, label]) => `<fieldset class="weekday" data-day="${key}"><legend>${label}</legend><div class="intervals">${(worker.shifts[key] || []).map(([a, b]) => intervalRow(a, b)).join('')}</div>
      <div class="day-controls"><span class="closed-day">Kapalı</span><button type="button" class="add-interval">Aralık ekle</button></div></fieldset>`).join('')}`;
  }

  function workingIntervals(form) {
    const shifts = {};
    for (const day of form.querySelectorAll('[data-day]')) {
      const ranges = [...day.querySelectorAll('.interval-row')].map(row => [
        toMinutes(row.querySelector('[name=start]').value),
        toMinutes(row.querySelector('[name=end]').value) || 1440,
      ]).sort((a, b) => a[0] - b[0]);
      const invalid = ranges.some(([start, end], index) => start >= end || (index > 0 && start < ranges[index - 1][1]));
      if (invalid) throw new Error(day.querySelector('legend').textContent + ' gününün saat aralıklarını kontrol edin.');
      if (ranges.length) shifts[day.dataset.day] = ranges;
    }
    return shifts;
  }

  function edit(type, id) {
    const draft = structuredClone(profile);
    let item, title, fields;
    if (type === 'shop') {
      title = 'Salon bilgileri';
      item = draft.shop;
      fields = shopFields(item);
    } else if (type === 'hours') {
      title = 'Çalışma saatleri';
      item = draft.barbers.find(b => b.id === id);
      fields = workweekFields(item);
    } else {
      const service = type === 'services';
      const items = service ? draft.services : draft.barbers;
      item = items.find(row => row.id === id);
      if (!item) {
        const newId = crypto.randomUUID();
        item = service ? { id: newId, duration: 30, active: true } : { id: newId, active: true, serviceIds: [], shifts: {} };
        items.push(item);
      }
      title = service ? (id ? 'Hizmeti düzenle' : 'Hizmet ekle') : (id ? 'Çalışanı düzenle' : 'Çalışan ekle');
      fields = service ? serviceFields(item) : workerFields(item);
    }
    modalContent.innerHTML = `<div class="modal-inner settings-editor"><div class="modal-top"><h2 id="modal-title">${title}</h2>
      <button class="close" type="button" aria-label="Kapat">×</button></div><form>${fields}
      <div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="secondary dismiss">Vazgeç</button><button type="submit" class="primary">Kaydet</button></div></form></div>`;
    const form = modalContent.querySelector('form');
    const errorBox = form.querySelector('.form-error');
    let busy = false;
    modalContent.querySelector('.close').onclick = form.querySelector('.dismiss').onclick = () => { if (!busy) modal.close(); };
    function onCancel(event) { if (busy) event.preventDefault(); }
    modal.addEventListener('cancel', onCancel);
    modal.addEventListener('close', () => modal.removeEventListener('cancel', onCancel), { once: true });
    form.onclick = event => {
      if (event.target.matches('.add-interval')) {
        const list = event.target.closest('.weekday').querySelector('.intervals');
        const last = list.querySelector('.interval-row:last-child [name=end]');
        const start = last ? Math.min(1425, (toMinutes(last.value) || 0) + 60) : 540;
        const end = last ? Math.min(1440, start + 60) : 1080;
        list.insertAdjacentHTML('beforeend', intervalRow(start, end));
        list.lastElementChild.querySelector('input').focus();
      }
      if (event.target.matches('.remove-interval')) {
        const weekday = event.target.closest('.weekday');
        event.target.closest('.interval-row').remove();
        weekday.querySelector('.add-interval').focus();
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(form);
      const save = form.querySelector('[type=submit]');
      errorBox.replaceChildren();
      busy = true;
      save.disabled = true;
      try {
        if (type === 'hours') item.shifts = workingIntervals(form);
        else {
          const textFields = type === 'shop' ? ['name', 'location', 'description', 'imageAlt', 'imagePath', 'logoPath']
            : type === 'services' ? ['name', 'category', 'description'] : ['name', 'title'];
          for (const key of textFields) item[key] = data.get(key).trim();
          if (type === 'shop') item.isDemo = data.has('isDemo');
          else item.active = data.has('active');
          if (type === 'services') {
            item.price = Number(data.get('price'));
            item.duration = Number(data.get('duration'));
            const assigned = new Set(data.getAll('assigned'));
            for (const barber of draft.barbers.filter(isActive)) {
              barber.serviceIds = barber.serviceIds.filter(serviceId => serviceId !== item.id);
              if (assigned.has(barber.id)) barber.serviceIds.push(item.id);
            }
          }
          if (type === 'staff') {
            const archived = new Set(profile.services.filter(s => !isActive(s)).map(s => s.id));
            item.serviceIds = [...item.serviceIds.filter(key => archived.has(key)), ...data.getAll('serviceIds')];
          }
        }
        const result = await request(endpoint, { profile: draft, revision }, 'PUT');
        if (!active()) return;
        ({ profile, revision } = result);
        onSave(profile.shop);
        modal.close();
        if (type === 'staff' && !id && item.active) { section = 'hours'; staffId = item.id; }
        render();
        app.querySelector('#settings-title').setAttribute('tabindex', '-1');
        app.querySelector('#settings-title').focus({ preventScroll: true });
        notify(type === 'staff' && !id && item.active ? 'Çalışan eklendi. Çalışma saatlerini belirleyin.' : 'Değişiklikler kaydedildi.');
      } catch (error) {
        if (!active() || showAccessPrompt(error)) return;
        errorBox.innerHTML = `<div class="error">${esc(error.message)}</div>`;
        if (error.code === 'PROFILE_STALE') {
          save.hidden = true;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary';
          button.textContent = 'Değişiklikleri bırak ve güncel ayarları yükle';
          button.onclick = () => { modal.close(); refresh(); };
          errorBox.append(button);
        }
        errorBox.scrollIntoView({ block: 'nearest' });
      } finally {
        busy = false;
        save.disabled = false;
      }
    };
    modal.showModal();
  }

  await refresh();
}
