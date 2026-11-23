# Randevu ve müşteri verisinin korunması

Müşteri hizmetleri, çalışanları ve boş saatleri okuyabilir, randevu oluşturabilir ve kendi gizli bağlantısıyla başlamamış randevusunu iptal edebilir. Ad ve telefon sunucuya gönderilir. Başka bir müşterinin randevu kaydını okuyan bir müşteri uç noktası yoktur.

| Durum | Koruma | Doğrulama |
| --- | --- | --- |
| İki müşteri aynı anda aynı berbere randevu alır | Zaman aralığı veritabanında yazma sırasında kontrol edilir. İkinci istek için uygulama yeni saat seçilmesini ister. | İki bağımsız HTTP isteğinde bir kayıt başarılı olur, diğeri 409 alır. |
| Onay yanıtı müşteriye ulaşmaz | Aynı randevunun tekrar gönderimi aynı istek kimliğiyle yapılır. Başarılı yanıtın referansı tekrar kullanılabilir. | Sunucu yeniden başlatıldıktan sonra aynı isteğin aynı referansı döndürdüğü kontrol edilir. |
| Tarayıcı eski veya değiştirilmiş seçimler gönderir | Sunucu hizmeti, personel yetkinliğini, vardiyayı, süreyi ve geçerli tarih aralığını kendi kataloğundan doğrular. | Randevu kural testleri uygunsuz kombinasyonları ve çakışan aralıkları kapsar. |
| İstek gövdesi gereksiz yere büyür veya başka bir sayfadan gönderilir | Kayıt yalnızca sınırlı boyuttaki JSON isteklerini kabul eder. Tarayıcı bir kaynak bildirdiğinde sunucu kendi kaynağıyla karşılaştırır. | HTTP testleri farklı kaynak için 403, büyük gövde için 413, yanlış içerik türü için 415 bekler. |
| İletişim bilgileri herkese açık bir yanıta girer | Müsaitlik yanıtı yalnızca saatleri döndürür. Kayıt yanıtı, müşteri adı ve telefonu içermez. SQL sorgularında değerler parametre olarak bağlanır. | HTTP testleri onay yanıtının alanlarını, randevu listesine ve sunucu dosyalarına erişimi kontrol eder. |

## Yetki sınırları

Salon sahibine ait gündem, iletişim bilgileri ve değişiklikler sunucuda yetkilendirilir. Sites üzerinde doğrulanmış sahip kimliği, bağımsız kurulumda ise süreli HttpOnly oturum kullanılır. Müşterinin iptal bağlantısı tek randevuya yetki verir. Bağlantıdaki imza tarayıcı fragmentinde taşınır ve sunucuya yalnızca iptal sayfasının JSON isteğinde iletilir. İptal önizlemesi iletişim bilgilerini döndürmez. SMS görevi için ayrı, yalnızca hatırlatmaları çalıştırabilen bir kimlik bilgisi kullanılır.

## İşletme kurulumu

- Müşteri adı ve telefonuna erişim, veritabanı ve işletmeci araçlarına erişimi olan kişilerle sınırlıdır. Her işletme için ayrı kurulum ve veritabanı kullanın. Paylaşılan sunucuda işletim sistemi hesabı ile yedeklerin erişim izinlerini de sınırlandırın.
- İşletmenin müşteriye göstereceği aydınlatma metnini, randevu geçmişinin saklama süresini ve süresi dolmuş kayıtların yedekler dahil nasıl kaldırılacağını satıştan önce belirleyin. İstek gövdelerini ve müşteri telefonlarını uygulama veya ters vekil günlüklerine yazmayın.
- Telefon numarasının biçim kontrolü, numaranın sahibini doğrulamaz. Konuk rezervasyonunda başka birinin telefonunun girilmesi veya birden çok bağlantıdan sahte rezervasyon yapılması hâlâ mümkündür. Böyle bir sorun yaşayan işletme için tek kullanımlık doğrulama kodu ve işletmeye özel limitler ayrı bir sürümde değerlendirilebilir.

## Kontrolleri çalıştırma

`npm test` geçici veritabanları kullanır. HTTP senaryolarında gerçek yerel uygulama ayağa kalkar ve test bitince kapatılır. Bu kontroller uygulamanın kodu ve örnek çalışma düzeniyle sınırlıdır. Üretim alan adının TLS ayarları, sağlayıcı hesabı izinleri, yedek erişimi ve silme süreçleri işletme kurulumu sırasında ayrıca doğrulanmalıdır.

## Başvuru kaynakları

- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
