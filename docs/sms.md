# Randevu SMS hatırlatmaları

Hatırlatmalar yalnızca randevu formunda SMS seçeneğini işaretleyen müşterilerin Türkiye cep telefonu numaralarına gönderilir. Önceki kayıtların ve işletme panelinden eklenen randevuların SMS tercihi varsayılan olarak kapalıdır.

Sistem İstanbul saatine göre 24 saat önce bir hatırlatma gönderir. Randevu 24 saatten kısa süre kala alınmışsa 2 saat önce, 2 saatten kısa süre kala alınmışsa takip eden ilk çalıştırmada gönderilir. Başlamasına 15 dakikadan az kalan ve iptal edilmiş randevular atlanır.

## Twilio kurulumu

Türkiye için Twilio’da kayıtlı bir alfasayısal gönderici adı gerekir. Hesabın Türkiye’ye mesaj göndermeye açık olduğunu doğrulayın. SMS içeriğinde yalnızca randevu hatırlatması bulunur.

| Ortam değişkeni | Değer |
| --- | --- |
| `SMS_ENABLED` | Gönderim için `true`. Diğer değerlerde ve değişken tanımsızken gönderim kapalıdır. |
| `TWILIO_ACCOUNT_SID` | Twilio hesabının SID’si. |
| `TWILIO_AUTH_TOKEN` | Twilio hesabının gizli yetkilendirme belirteci. |
| `TWILIO_SENDER_ID` | Türkiye için kayıtlı gönderici adı. |
| `SMS_TURKEY_LOCAL_ENTITY` | Yalnızca sağlayıcı hesabında Türkiye’deki yerel tüzel kişilik üzerinden bağlantılı SMS gönderimi doğrulandıysa `true`. |
| `APP_ORIGIN` | Bağlantılı SMS için zorunlu. Müşterinin ulaşabileceği HTTPS kökeni, ör. `https://makas.example`. |

Twilio, Türkiye’de yerel tüzel kişiliği bulunmayan şirketlerin Türkiye numaralarına gönderdiği SMS’lerde URL’ye izin vermez. `SMS_TURKEY_LOCAL_ENTITY` belirtilmezse hatırlatmada müşteri randevu onayına yönlendirilir. Belirtilirse SMS, onay ekranındaki aynı kişiye özel iptal bağlantısını içerir. Gizli Twilio değerlerini barındırma ortamının gizli değişkenleri olarak tutun.

[Twilio Türkiye SMS kuralları](https://www.twilio.com/en-us/guidelines/tr/sms) · [Twilio gönderici adı kaydı](https://help.twilio.com/articles/4416881468187-Documents-Required-and-Instructions-to-Register-Your-Alphanumeric-Sender-ID-in-Turkey)

## Çalıştırma ve teslim durumu

Yerel SQLite kullanılıyorsa, randevu uygulamasının kullandığı `BOOKING_DATABASE` ve SMS ortam ayarlarıyla `npm run reminders` komutunu çalıştırın. Düzenli gönderim için bu komutu sistem zamanlayıcısında 5 dakikada bir çalıştırın. Barındırılan uygulamada, bir HTTPS zamanlayıcısından `POST /api/jobs/reminders` çağırın. İsteğin `Authorization` başlığını, barındırma ortamındaki gizli `JOB_SECRET` değeriyle `Bearer <JOB_SECRET>` biçiminde gönderin. Yerel ve barındırılan zamanlayıcıların her biri kendi veritabanındaki kayıtları işler.

Her çalıştırma yalnızca kabul, tekrar deneme, kesin hata ve belirsiz gönderim sayılarını döndürür. Kabul sayısı Twilio’nun isteği kabul ettiğini gösterir. 429 hız sınırı hatası alan istek, randevu hâlâ uygunsa 5 ve ardından 10 dakika beklenerek en fazla iki kez tekrar denenir. Ağ kesintisi veya sunucu yanıtı nedeniyle sonucu belirsiz istekler ve gönderim esnasında yarıda kalan kayıtlar otomatik olarak tekrar gönderilmez. Bu kayıtların sonucunu Twilio Mesaj Günlükleri’nde denetleyin. [Twilio 429 yanıtı](https://www.twilio.com/docs/api/errors/20429)

Geliştirme ortamında gönderim varsayılan olarak kapalıdır. `node --test tests/reminders.test.mjs` ağ bağlantısı kurmadan sahte sağlayıcıyla çalışır.
