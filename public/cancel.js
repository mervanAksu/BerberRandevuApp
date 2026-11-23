import { applySalonBrand } from './branding.js';

const token = location.hash.slice(1);
const status = document.getElementById('cancel-status');
const details = document.getElementById('cancel-details');
const error = document.getElementById('cancel-error');
const confirmButton = document.getElementById('cancel-confirm');
const retryButton = document.getElementById('cancel-retry');
const heading = document.getElementById('cancel-heading');
const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'long',
  timeZone: 'UTC',
});
const messages = {
  active: 'Aşağıdaki randevuyu iptal etmek istiyorsan “Randevuyu iptal et” düğmesine bas.',
  cancelled: 'Randevun iptal edildi.',
  past: 'Bu randevu başladı. İptal edilemez.',
};

function detailRow(label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  return row;
}

async function load(confirm = false) {
  if (!token) {
    status.textContent = 'Randevu onayındaki özel iptal bağlantısını kullan.';
    return;
  }

  retryButton.hidden = true;
  confirmButton.disabled = true;
  error.hidden = true;
  status.textContent = confirm ? 'Randevu iptal ediliyor…' : 'Randevu ayrıntıları yükleniyor…';
  try {
    const response = await fetch(confirm ? '/api/cancel/confirm' : '/api/cancel/preview', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(confirm ? { token, confirm: true } : { token }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === 'BOOKING_STARTED') {
        await load();
        heading.focus();
        return;
      }
      if (data.code === 'INVALID_CANCEL_LINK') {
        status.textContent = data.error;
        details.hidden = confirmButton.hidden = true;
        return;
      }
      throw new Error();
    }

    details.replaceChildren(
      detailRow('Randevu kodu', data.reference),
      detailRow('Hizmet', data.services.join(', ')),
      detailRow('Berber', data.barber),
      detailRow('Tarih ve saat', dateFormat.format(new Date(data.date + 'T00:00:00Z')) + ' · ' + data.time),
    );
    details.hidden = false;
    status.textContent = messages[data.status];
    confirmButton.hidden = data.status !== 'active';
    if (confirm) heading.focus();
  } catch {
    status.textContent = '';
    error.textContent = confirm
      ? 'İptal işleminin sonucu alınamadı. Randevunun durumunu tekrar kontrol et.'
      : 'Randevu ayrıntıları yüklenemedi. Tekrar dene.';
    error.hidden = false;
    confirmButton.hidden = true;
    retryButton.hidden = false;
    if (confirm) retryButton.focus();
  } finally {
    confirmButton.disabled = false;
  }
}

confirmButton.addEventListener('click', () => void load(true));
retryButton.addEventListener('click', () => void load());
void load();

fetch('/api/catalog', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(catalog => applySalonBrand(catalog?.shop))
  .catch(() => {}); // The cancellation link still works when branding is unavailable.
