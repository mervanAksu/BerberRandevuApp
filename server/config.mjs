export const shop = {
  name: 'Makas',
  location: 'Moda, Kadıköy',
  timeZone: 'Europe/Istanbul',
};

export const services = [
  {
    id: 'sac-kesimi',
    name: 'Saç Kesimi',
    description: 'Yüz şekline ve saç yapına uygun kesim, yıkama ve şekillendirme.',
    price: 850,
    duration: 45,
    category: 'Saç',
  },
  {
    id: 'sakal-tirasi',
    name: 'Sakal Tıraşı',
    description: 'Sıcak havlu, sakal şekillendirme ve çizgi düzeltme.',
    price: 500,
    duration: 30,
    category: 'Sakal',
  },
  {
    id: 'sac-sakal',
    name: 'Saç & Sakal',
    description: 'Saç kesimi ve sakal tıraşı tek randevuda.',
    price: 1200,
    duration: 60,
    category: 'Bakım',
  },
  {
    id: 'sac-boyama',
    name: 'Saç Boyama',
    description: 'Doğal tonlarda saç boyama ve son şekillendirme.',
    price: 1400,
    duration: 75,
    category: 'Saç',
  },
  {
    id: 'yuz-bakimi',
    name: 'Yüz Ağdası',
    description: 'Yüz çevresindeki istenmeyen tüyler için bölgesel ağda.',
    price: 350,
    duration: 15,
    category: 'Bakım',
  },
];

export function minutesSinceMidnight(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function shift(open, breakStart, breakEnd, close) {
  return [
    [minutesSinceMidnight(open), minutesSinceMidnight(breakStart)],
    [minutesSinceMidnight(breakEnd), minutesSinceMidnight(close)],
  ];
}

const earlyShift = shift('10:00', '13:00', '13:45', '20:00');
const laterShift = shift('11:00', '14:00', '14:45', '20:00');
const noonShift = shift('12:00', '15:00', '15:45', '20:00');
const sundayShift = shift('11:00', '14:00', '14:45', '18:00');

export const barbers = [
  {
    id: 'emir',
    name: 'Emir Kaya',
    title: 'Kıdemli berber',
    serviceIds: ['sac-kesimi', 'sakal-tirasi', 'sac-sakal', 'yuz-bakimi'],
    shifts: {
      0: sundayShift,
      1: earlyShift,
      2: shift('10:00', '13:00', '13:45', '18:00'),
      4: earlyShift,
      5: earlyShift,
      6: earlyShift,
    },
  },
  {
    id: 'kerem',
    name: 'Kerem Aydın',
    title: 'Berber',
    serviceIds: ['sac-kesimi', 'sakal-tirasi', 'sac-sakal', 'sac-boyama'],
    shifts: {
      1: laterShift,
      2: noonShift,
      3: earlyShift,
      5: laterShift,
      6: shift('10:00', '13:00', '13:45', '19:00'),
    },
  },
  {
    id: 'deniz',
    name: 'Deniz Arslan',
    title: 'Saç ve bakım uzmanı',
    serviceIds: ['sac-kesimi', 'sac-sakal', 'sac-boyama', 'yuz-bakimi'],
    shifts: {
      0: sundayShift,
      1: noonShift,
      2: shift('10:00', '13:00', '13:45', '19:00'),
      3: laterShift,
      4: earlyShift,
      6: laterShift,
    },
  },
];
