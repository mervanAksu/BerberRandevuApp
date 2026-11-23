const app = document.getElementById('booking-app');
const announcer = document.getElementById('announcer');
const titles = ['Hizmet', 'Berber', 'Tarih', 'Saat', 'Bilgiler'];
const headings = ['Hizmet seçimi', 'Berber seçimi', 'Tarih seçimi', 'Saat seçimi', 'Kişisel bilgiler'];
const serviceIcons = {
  'sac-kesimi': 'cut', 'sakal-tirasi': 'beard', 'sac-sakal': 'combo',
  'sac-boyama': 'color', 'yuz-bakimi': 'wax',
};
const currency = new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 0,
});
const receiptMedia = window.matchMedia('(min-width: 761px)');
let catalog;
let receiptOpen = receiptMedia.matches;
let slotRequest;
let dateChecks = new Map();
let dateOffset = 0;
let timeOptions = [];
let checking = false;
let loadError = '';
let formError = '';
let formErrorField = '';
let conflictNotice = '';
let quoteNotice = '';
let submitting = false;
let result;
const initial = () => ({ step: 0, serviceIds: [], barberId: '', date: '', time: '', name: '', phone: '', requestId: '' });
let draft = initial();

function element(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '/icons.svg#' + name);
  svg.append(use);
  return svg;
}

function button(label, className, action, key) {
  const el = element('button', className, label);
  el.type = 'button';
  if (key) el.dataset.focus = key;
  el.addEventListener('click', action);
  return el;
}

function alertBox(message, retry, retryLabel = 'Tekrar dene') {
  const node = element('div', 'alert');
  node.setAttribute('role', 'alert');
  node.append(element('p', '', message));
  if (retry) node.append(button(retryLabel, '', retry));
  return node;
}

async function request(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Sunucudan yanıt alınamadı. Tekrar dene.');
  }
  if (!response.ok) {
    const error = new Error(body.error || 'İşlem tamamlanamadı. Tekrar dene.');
    error.code = body.code;
    throw error;
  }
  return body;
}

const services = () => catalog.services.filter(s => draft.serviceIds.includes(s.id));
const qualified = ids => catalog.barbers.filter(b => ids.every(id => b.serviceIds.includes(id)));
const barber = () => catalog.barbers.find(b => b.id === draft.barberId);
const price = () => services().reduce((sum, s) => sum + s.price, 0);
const duration = () => services().reduce((sum, s) => sum + s.duration, 0);
const serviceNames = () => services().map(s => s.name).join(', ');
const dayDate = day => new Date(day + 'T12:00:00Z');
function dateLabel(day, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return day ? dayDate(day).toLocaleDateString('tr-TR', { ...options, timeZone: 'UTC' }) : '';
}
function offsetDay(start, days) {
  const d = dayDate(start);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function week() {
  return Array.from({ length: 7 }, (_, i) => offsetDay(catalog.today, dateOffset + i)).filter(day => day <= catalog.lastDate);
}
function selectionValues() {
  return [serviceNames(), barber()?.name, dateLabel(draft.date), draft.time];
}

function stepper() {
  const nav = element('nav');
  nav.setAttribute('aria-label', 'Randevu adımları');
  const list = element('ol', 'steps');
  const values = selectionValues();
  titles.forEach((title, i) => {
    const done = i < draft.step;
    const current = i === draft.step;
    const item = element('li', !done && !current ? 'upcoming' : '');
    const control = button('', 'step-link' + (done ? ' completed' : ''), () => go(i), 'step-' + i);
    control.disabled = !done || submitting;
    control.setAttribute('aria-label', (i + 1) + '. ' + headings[i] + (done ? ', ' + values[i] + ', değiştir' : ''));
    if (current) control.setAttribute('aria-current', 'step');
    const number = element('span', 'step-num', i + 1);
    if (done) number.replaceChildren(icon('check'));
    control.append(number, element('span', 'step-text', title));
    if (done) control.append(element('span', 'step-value', values[i]), element('span', 'step-change', 'Değiştir'));
    if (current) control.append(element('span', 'mobile-step-counter', 'Adım ' + (i + 1) + ' / 5'));
    item.append(control);
    list.append(item);
  });
  nav.append(list);
  return nav;
}

function receipt() {
  const node = element('details', 'receipt');
  node.open = receiptOpen;
  node.addEventListener('toggle', () => { if (node.isConnected) receiptOpen = node.open; });
  const summary = element('summary');
  summary.dataset.focus = 'summary';
  const disclose = icon('chevron');
  disclose.classList.add('disclose');
  summary.append(icon('receipt'), element('h3', '', 'Randevu özeti'), disclose);
  const list = element('dl');
  selectionValues().forEach((value, i) => {
    const row = element('div');
    const dd = element('dd', value ? '' : 'empty', value || '—');
    if (i < draft.step && value) {
      const edit = button(value, 'receipt-edit', () => go(i), 'summary-' + i);
      edit.disabled = submitting;
      edit.setAttribute('aria-label', titles[i] + ' seçimini değiştir: ' + value);
      dd.replaceChildren(edit);
    }
    row.append(element('dt', '', titles[i]), dd);
    list.append(row);
  });
  const total = element('div', 'total');
  total.append(element('span', '', 'Toplam'), element('strong', '', draft.serviceIds.length ? currency.format(price()) : '—'));
  node.append(summary, list, total);
  if (draft.serviceIds.length) node.append(element('small', '', duration() + ' dakika'));
  return node;
}

function marker(selected) {
  const mark = element('span', 'choice-mark');
  mark.setAttribute('aria-hidden', 'true');
  if (selected) mark.append(icon('check'));
  return mark;
}

function actions(content, allowed = true, nextLabel = 'Devam et') {
  const row = element('div', 'actions');
  if (draft.step > 0) {
    const back = button('Geri', 'secondary', () => go(draft.step - 1), 'back');
    back.disabled = submitting;
    row.append(back);
  }
  const next = button(nextLabel, 'primary', () => go(draft.step + 1), 'next');
  next.disabled = !allowed;
  row.append(next);
  content.append(row);
}

function conflictingService(id) {
  const parts = ['sac-kesimi', 'sakal-tirasi'];
  if (id === 'sac-sakal' && parts.some(part => draft.serviceIds.includes(part))) {
    return 'Paketi seçmek için ayrı kesim veya tıraş seçimini kaldır.';
  }
  if (parts.includes(id) && draft.serviceIds.includes('sac-sakal')) return 'Seçtiğin Saç & Sakal paketine dahil.';
  if (!qualified([...draft.serviceIds, id]).length) return 'Seçili hizmetlerle birlikte sunan berber yok.';
  return '';
}

function servicesStep(panel) {
  if (quoteNotice) panel.append(alertBox(quoteNotice));
  const group = element('div', 'option-list');
  for (const service of catalog.services) {
    const selected = draft.serviceIds.includes(service.id);
    const reason = selected ? '' : conflictingService(service.id);
    const choice = button('', 'option service-option', () => {
      const updated = selected ? draft.serviceIds.filter(id => id !== service.id) : [...draft.serviceIds, service.id];
      draft.serviceIds = catalog.services.map(s => s.id).filter(id => updated.includes(id));
      if (!updated.length || !qualified(updated).some(b => b.id === draft.barberId)) draft.barberId = '';
      resetSchedule();
      render();
      announcer.textContent = service.name + (selected ? ' çıkarıldı.' : ' eklendi.');
    }, service.id);
    choice.disabled = Boolean(reason);
    choice.setAttribute('aria-pressed', String(selected));
    choice.title = reason || service.description;
    const medallion = element('span', 'option-icon');
    medallion.append(icon(serviceIcons[service.id] || 'cut'));
    const info = element('span', 'option-info');
    const meta = element('span', 'option-meta');
    if (!reason) meta.append(icon('clock'));
    meta.append(document.createTextNode(reason || service.duration + ' dk'));
    info.append(element('span', 'option-name', service.name), meta);
    choice.append(medallion, info, element('span', 'option-price', currency.format(service.price)), marker(selected));
    group.append(choice);
  }
  panel.append(group);
  actions(panel, Boolean(draft.serviceIds.length), 'Berber seçimine geç');
}

function barbersStep(panel) {
  const group = element('div', 'option-list');
  for (const person of qualified(draft.serviceIds)) {
    const selected = person.id === draft.barberId;
    const choice = button('', 'option', () => {
      if (draft.barberId !== person.id) {
        draft.barberId = person.id;
        resetSchedule();
      }
      render();
    }, 'barber-' + person.id);
    choice.setAttribute('aria-pressed', String(selected));
    const avatar = element('span', 'avatar', person.name.split(' ').map(p => p[0]).slice(0, 2).join(''));
    avatar.setAttribute('aria-hidden', 'true');
    const info = element('span', 'option-info');
    info.append(element('span', 'option-name', person.name), element('span', 'option-meta', person.title));
    choice.append(avatar, info, marker(selected));
    group.append(choice);
  }
  panel.append(group);
  actions(panel, Boolean(barber()), 'Tarih seçimine geç');
}

function resetSchedule() {
  draft.date = '';
  draft.time = '';
  draft.requestId = '';
  dateOffset = 0;
  dateChecks.clear();
  conflictNotice = '';
}

function pageButton(label, previous, disabled) {
  const el = button('', 'icon-button' + (previous ? ' previous' : ''), () => {
    dateOffset += previous ? -7 : 7;
    draft.date = draft.time = draft.requestId = '';
    loadDates();
  }, previous ? 'prev-week' : 'next-week');
  el.setAttribute('aria-label', label);
  el.disabled = disabled;
  el.append(icon('chevron'));
  return el;
}

function datesStep(panel) {
  const days = week();
  const toolbar = element('div', 'date-toolbar');
  const range = dateLabel(days[0], { day: 'numeric', month: 'short' }) + ' – ' +
    dateLabel(days.at(-1), { day: 'numeric', month: 'short', year: 'numeric' });
  const pages = element('div', 'date-pages');
  pages.append(pageButton('Önceki günler', true, dateOffset === 0), pageButton('Sonraki günler', false, days.at(-1) >= catalog.lastDate));
  toolbar.append(element('h4', '', range), pages);
  const grid = element('div', 'date-grid');
  for (const day of days) {
    const known = dateChecks.has(day);
    const full = known && dateChecks.get(day).length === 0;
    const selected = day === draft.date;
    const choice = button('', 'date-cell', () => {
      if (draft.date !== day) {
        draft.date = day;
        draft.time = '';
        draft.requestId = '';
      }
      render();
    }, 'date-' + day);
    choice.disabled = full || (checking && !known);
    const fullDate = dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    choice.setAttribute('aria-label', fullDate + (full ? ', müsait saat yok' : ''));
    choice.setAttribute('aria-pressed', String(selected));
    choice.append(element('span', 'weekday', day === catalog.today ? 'Bugün' : dateLabel(day, { weekday: 'short' })),
      element('strong', '', dateLabel(day, { day: 'numeric' })));
    grid.append(choice);
  }
  panel.append(toolbar, grid);
  if (checking) panel.append(element('p', 'calendar-note', 'Günlerin müsaitliği kontrol ediliyor…'));
  else if (loadError) panel.append(alertBox(loadError, loadDates));
  else if (days.every(day => dateChecks.get(day)?.length === 0)) panel.append(element('p', 'notice', 'Bu günlerde uygun saat yok. Başka günlere veya başka bir berbere bakabilirsin.'));
  else if (days.some(day => dateChecks.get(day)?.length === 0)) panel.append(element('p', 'calendar-note', 'Üzeri çizili günlerde bu hizmet için müsait saat yok.'));
  actions(panel, Boolean(draft.date) && !checking, 'Saat seçimine geç');
}

function timesStep(panel) {
  if (conflictNotice) panel.append(alertBox(conflictNotice));
  if (checking) panel.append(element('p', 'loading', 'Müsait saatler yükleniyor…'));
  else if (loadError) panel.append(alertBox(loadError, loadTimes));
  else if (!timeOptions.length) panel.append(element('p', 'notice', 'Bu tarihte uygun saat kalmadı. Geri dönüp başka bir tarih seçebilirsin.'));
  else {
    const times = element('div', 'times');
    for (const [name, start, end] of [['Sabah', 0, 12], ['Öğleden sonra', 12, 17], ['Akşam', 17, 24]]) {
      const group = timeOptions.filter(time => Number(time.slice(0, 2)) >= start && Number(time.slice(0, 2)) < end);
      if (!group.length) continue;
      const grid = element('div', 'time-grid');
      for (const time of group) {
        const choice = button(time, 'time-cell', () => {
          if (draft.time !== time) draft.requestId = '';
          draft.time = time;
          conflictNotice = '';
          render();
        }, 'time-' + time);
        choice.setAttribute('aria-pressed', String(draft.time === time));
        grid.append(choice);
      }
      times.append(element('h4', '', name), grid);
    }
    panel.append(times);
  }
  actions(panel, !checking && !loadError && timeOptions.includes(draft.time), 'Bilgilerime geç');
}

function field(name, title, type, placeholder, maxLength) {
  const container = element('div', 'field');
  const label = element('label', '', title);
  const input = element('input');
  label.htmlFor = input.id = 'booking-' + name;
  input.name = name;
  input.type = type;
  if (type === 'tel') input.inputMode = 'tel';
  input.autocomplete = name === 'name' ? 'name' : 'tel';
  input.placeholder = placeholder;
  input.required = true;
  input.maxLength = maxLength;
  input.disabled = submitting;
  input.value = draft[name];
  if (formErrorField === name) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'booking-error');
  }
  input.addEventListener('input', () => {
    draft[name] = input.value;
    draft.requestId = '';
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  });
  container.append(label, input);
  return container;
}

function detailsStep(panel) {
  const form = element('form', 'booking-form');
  const note = element('p', 'notice', 'Burası örnek bir salon. Deneme randevusu için örnek ad ve telefon kullan.');
  form.append(note, field('name', 'Ad soyad', 'text', 'Ör. Deniz Örnek', 80),
    field('phone', 'Telefon numarası', 'tel', '05XX XXX XX XX', 64));
  const review = element('div', 'form-review');
  review.append(element('strong', '', serviceNames()), element('p', '', barber().name + ' · ' + dateLabel(draft.date) + ' · ' + draft.time),
    element('p', '', duration() + ' dakika · Toplam ' + currency.format(price())));
  form.append(review);
  if (formError) {
    const error = alertBox(formError);
    error.id = 'booking-error';
    form.append(error);
  }
  const row = element('div', 'actions');
  const back = button('Geri', 'secondary', () => go(3), 'back');
  const submit = element('button', 'primary', submitting ? 'Kaydediliyor…' : 'Randevuyu onayla');
  submit.type = 'submit';
  submit.dataset.focus = 'submit';
  submit.disabled = back.disabled = submitting;
  row.append(back, submit);
  form.append(row);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (form.reportValidity()) save();
  });
  panel.append(form);
}

function readOnlyRow(label, value) {
  const row = element('div');
  row.append(element('dt', '', label), element('dd', '', value));
  return row;
}

function confirmation() {
  const panel = element('div', 'confirmation');
  const badge = element('span', 'success-mark');
  badge.append(icon('check'));
  const heading = element('h3', '', 'Randevun oluşturuldu.');
  heading.id = 'step-heading';
  heading.tabIndex = -1;
  const rows = element('dl');
  rows.append(readOnlyRow('Randevu kodu', result.reference), readOnlyRow('Hizmet', serviceNames()),
    readOnlyRow('Berber', barber().name), readOnlyRow('Tarih ve saat', dateLabel(result.date) + ' · ' + result.time),
    readOnlyRow('Süre', result.duration + ' dakika'), readOnlyRow('Toplam', currency.format(result.price)));
  panel.append(badge, heading, element('p', 'subtle', 'Deneme randevunun kodunu ve ayrıntılarını aşağıda bulabilirsin.'), rows,
    button('Yeni randevu oluştur', 'secondary', () => {
      draft = initial();
      result = null;
      dateOffset = 0;
      conflictNotice = '';
      quoteNotice = '';
      loadCatalog(true);
    }));
  return panel;
}

function render(focusHeading = false) {
  const headingWasFocused = app.contains(document.activeElement) && document.activeElement.id === 'step-heading';
  const oldKey = app.contains(document.activeElement) ? document.activeElement.dataset.focus : '';
  const currentReceipt = app.querySelector('details');
  if (currentReceipt) receiptOpen = currentReceipt.open;
  if (result) app.replaceChildren(confirmation());
  else {
    const workspace = element('div', 'workspace');
    const left = element('div');
    const panel = element('section', 'step-panel');
    panel.setAttribute('aria-labelledby', 'step-heading');
    const header = element('header', 'step-header');
    const heading = element('h3', '', headings[draft.step]);
    heading.id = 'step-heading';
    heading.tabIndex = -1;
    const descriptions = [
      'Bir veya birden fazla hizmet seçebilirsin.',
      'Seçtiğin hizmetleri sunan berberlerden birini seç.',
      'Berberinin takviminden sana uygun bir gün seç.',
      dateLabel(draft.date, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + (barber()?.name || ''),
      'Onaylamadan önce randevu ayrıntılarını kontrol et.',
    ];
    header.append(heading, element('p', '', descriptions[draft.step]));
    panel.append(header);
    [servicesStep, barbersStep, datesStep, timesStep, detailsStep][draft.step](panel);
    left.append(stepper(), panel);
    workspace.append(left, receipt());
    app.replaceChildren(workspace);
  }
  if (focusHeading || headingWasFocused) {
    const heading = document.getElementById('step-heading');
    heading.focus({ preventScroll: true });
    if (focusHeading && (heading.getBoundingClientRect().top < 0 || heading.getBoundingClientRect().top > window.innerHeight * .78)) {
      document.getElementById('randevu').scrollIntoView({ block: 'start' });
    }
  } else if (oldKey) {
    Array.from(app.querySelectorAll('[data-focus]')).find(el => el.dataset.focus === oldKey && !el.disabled)?.focus({ preventScroll: true });
  }
}

function queryDay(day, signal) {
  const query = new URLSearchParams({ barberId: draft.barberId, date: day });
  draft.serviceIds.forEach(id => query.append('serviceId', id));
  return request('/api/slots?' + query, { signal }).then(body => body.slots);
}

function startLookup() {
  slotRequest?.abort();
  slotRequest = new AbortController();
  checking = true;
  loadError = '';
  return slotRequest.signal;
}

async function loadDates(focus = false) {
  const signal = startLookup();
  const days = week();
  dateChecks = new Map();
  render(focus === true);
  const responses = await Promise.allSettled(days.map(day => queryDay(day, signal)));
  if (signal.aborted) return;
  checking = false;
  responses.forEach((response, i) => {
    if (response.status === 'fulfilled') dateChecks.set(days[i], response.value);
    else loadError = 'Bazı günlerin müsaitliği alınamadı. Tekrar deneyebilir veya gün seçerek saatleri kontrol edebilirsin.';
  });
  if (dateChecks.get(draft.date)?.length === 0) {
    draft.date = draft.time = draft.requestId = '';
  }
  render();
}

async function loadTimes(focus = false) {
  const signal = startLookup();
  timeOptions = [];
  render(focus === true);
  try {
    const slots = await queryDay(draft.date, signal);
    if (signal.aborted) return;
    timeOptions = slots;
    if (draft.time && !slots.includes(draft.time)) {
      draft.time = draft.requestId = '';
      conflictNotice = 'Önceki saat seçimin artık müsait değil. Yeni bir saat seç.';
    }
  } catch (error) {
    if (signal.aborted) return;
    loadError = error.code ? error.message : 'Müsait saatler alınamadı. Bağlantını kontrol edip tekrar dene.';
  }
  checking = false;
  render();
}

function go(step) {
  if (submitting) return;
  slotRequest?.abort();
  draft.step = step;
  formError = formErrorField = loadError = conflictNotice = '';
  checking = false;
  if (step === 2) loadDates(true);
  else if (step === 3) loadTimes(true);
  else render(true);
}

async function save() {
  if (submitting) return;
  const { serviceIds, barberId, date, time, name, phone } = draft;
  if (!draft.requestId) draft.requestId = crypto.randomUUID();
  const payload = { serviceIds, barberId, date, time, name, phone, requestId: draft.requestId,
    quotedPrice: price(), quotedDuration: duration() };
  formError = '';
  formErrorField = '';
  submitting = true;
  render();
  try {
    result = await request('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    draft.name = draft.phone = '';
    submitting = false;
    render(true);
  } catch (error) {
    submitting = false;
    if (error.code === 'QUOTE_CHANGED') {
      draft.serviceIds = [];
      draft.barberId = '';
      draft.step = 0;
      resetSchedule();
      quoteNotice = 'Hizmetlerin fiyatı veya süresi değişti. Güncel bilgileri inceleyip seçimini yeniden yap.';
      loadCatalog(true);
    } else if (['SLOT_TAKEN', 'SLOT_UNAVAILABLE', 'BOOKING_CANCELLED'].includes(error.code)) {
      draft.time = draft.requestId = '';
      draft.step = 3;
      conflictNotice = error.message;
      loadTimes(true);
    } else {
      if (error.code === 'REQUEST_ID_REUSED') draft.requestId = '';
      formError = error.code ? error.message : 'Onay cevabı alınamadı. Aynı randevuyu kontrol etmek için bilgileri değiştirmeden tekrar onayla.';
      formErrorField = { INVALID_NAME: 'name', INVALID_PHONE: 'phone' }[error.code] || '';
      render();
      if (formErrorField) document.getElementById('booking-' + formErrorField).focus();
      else app.querySelector('[data-focus=submit]')?.focus({ preventScroll: true });
    }
  }
}

async function loadCatalog(focus = false) {
  app.setAttribute('aria-busy', 'true');
  try {
    catalog = await request('/api/catalog');
    document.getElementById('shop-location').textContent = catalog.shop.location;
    render(focus === true);
  } catch {
    app.replaceChildren(alertBox('Hizmet listesi yüklenemedi. Bağlantını kontrol edip tekrar dene.', loadCatalog));
  } finally {
    app.setAttribute('aria-busy', 'false');
  }
}

const dialog = document.getElementById('salon-dialog');
document.querySelectorAll('.salon-trigger').forEach(el => el.addEventListener('click', () => dialog.showModal()));
document.getElementById('salon-close').addEventListener('click', () => dialog.close());
document.getElementById('salon-book').addEventListener('click', () => {
  dialog.close();
  document.getElementById('booking-heading').focus();
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
loadCatalog();
