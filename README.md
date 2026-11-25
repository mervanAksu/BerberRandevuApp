# Makas SaaS — İzole Demo

Bu, mevcut Makas canlı sisteminden **ayrı** bir çoklu salon deneme projesidir. Gerçek müşteri verisi içermez; üretim yetkilendirmesi veya abonelik altyapısı olduğunu iddia etmez.

Amaç: Bir salonun hizmet, personel ve randevu kayıtlarının başka bir salonla karışmadığını sunucu sorgularında doğrulamak; gerçek geçişten önce akışı değerlendirmek.

İşletme seçici yalnızca demo içindir. Üretime geçmeden önce tenant kimliği istemci seçimiyle değil güvenilir oturum kimliğiyle bağlanmalıdır; abonelik, denetim kayıtları, yedekleme ve personel rolleri eklenmelidir.

## Yönetim modeli

[Yönetim planı](docs/yonetim-plani.svg) üç rolün kapsamını gösterir.

| Rol | Sorumluluk |
| --- | --- |
| Platform yöneticisi | Salon açılışları, işletme sahiplerinin erişimi, abonelik ve platformun genel işleyişi. |
| İşletme sahibi | Kendi salonunun ajandası, çalışanları, hizmetleri ve randevu durumları. |
| Müşteri | Salonun bağlantısından uygun randevuyu seçme ve kendi randevusunu takip etme. |

Bu sürüm işletme sahibinin günlük ajandasını canlandırır. Salon seçici örnek işletmeler arasında deneme yapmak içindir. Gerçek platform yönetimi ve müşteri arayüzü ayrı ürün görünümleri olarak planlanır.

## Doğrulama

`npm test` geçici SQLite üzerinde salon ayrımını, randevu durumlarını ve mevcut kayıtlarla şema geçişini kontrol eder. `npm run build` yayınlanacak Worker ve veritabanı geçişlerini hazırlar.
