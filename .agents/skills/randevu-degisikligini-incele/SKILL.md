---
name: randevu-degisikligini-incele
description: Makas projesindeki hizmet, personel, müsaitlik, rezervasyon, vardiya, yeniden deneme veya müşteri bilgileri değiştiğinde API ve müşteri akışını birlikte doğrular.
---

# Randevu değişikliğini incele

1. Değişiklikten etkilenen bir hizmet, uygun bir berber ve İstanbul saatine göre gelecek bir vardiya seç. Beklenen süreyi ve bitişi sunucu kataloğundan hesapla. Yerel testte sentetik ad ve telefon kullan.
2. Normal girişten randevu oluştur. Sonraki sorguda çakışan tüm başlangıçların kaybolduğunu ve bitiş anında başlayan uygun bir randevunun mümkün olduğunu doğrula. Öğle arası veya kapanışa sığmayan süreleri ayrıca ele al.
3. Aynı isteği aynı kimlikle tekrarla. Tek kayıt ve aynı referansı bekle. Aynı saati farklı kimliklerle isteyen iki müşteriden yalnızca birinin onay alabildiğini doğrula.
4. Önceki seçim değiştiğinde özet, çalışan listesi ve saatlerin sunucunun yeni yanıtıyla eşleştiğini kontrol et. Saat başkası tarafından alınırsa müşterinin formdan geri dönebildiğini doğrula.
5. Katalog, müsaitlik, hata yanıtları ve tarayıcı depolamasında müşteri adı, telefonu veya başka müşterinin randevu bilgisini ara. İşletme araçlarını yalnızca geçici bir yerel veritabanında dene.
6. `npm test` ve `npm run build` çalıştır. Hangi senaryonun hangi ortamda doğrulandığını ve denetlenemeyen noktayı teslimde belirt.
