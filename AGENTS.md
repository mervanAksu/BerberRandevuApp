# BerberRandevuApp ile çalışma

Bu repo, bağımsız bir berber salonunun müşteriye açık randevu akışını barındırır. Müşteri metinleri Türkçedir. Demo salon Moda'daki kurgusal Makas'tır. Yeni salon kurulumunda hizmetleri, süreleri, fiyatları ve vardiyaları sunucu kataloğunda değiştirin.

## Görev dağılımı

Orkestratör önce talebin kabul örneğini ve etkilenen dosyaları belirler. Paralel görevleri çakışmayacak dosyalara ayırır. Her ajana kullanıcı senaryosunu, sahibi olduğu dosyaları, diğer ajanlarla paylaşacağı veri sözleşmesini ve doğrulama komutunu verir. Aşağıdaki görev tanımlarını değişikliğin kapsamına uyarlayın.

| Sorumlu | Görev promptu | Teslim |
| --- | --- | --- |
| Tasarım araştırmacısı | Salonda telefondan randevu alan bir müşterinin kararını zorlaştıran noktayı incele. İlgili bir gerçek örnekle önerini gerekçelendir. | Kaynak, çözülmesi gereken karar, mobil etkileşim önerisi |
| Arayüz geliştirici | public/ altında hizmet, personel, tarih, saat ve müşteri bilgileri akışını sürdür. Seçim değişirse bağımlı adımları ve özeti güncelle. | Uygulanmış ekran, yükleniyor/boş/hata/başarı davranışları |
| Randevu geliştirici | server/ ve drizzle/ altında İstanbul saatine, hizmet yetkinliğine, vardiyalara ve çakışmalara ilişkin kuralları uygula. | API sözleşmesi, atomik yazma, tekrar denenebilirlik ve regresyon testleri |
| Çalışma ortamı geliştirici | Yerel SQLite ve barındırılan D1 yollarını aynı API üzerinden çalıştır. Göçleri, derlemeyi ve işletme araçlarını doğrula. | Temiz kurulum komutu, kalıcılık ve paket doğrulaması |
| Bağımsız incelemeci | Değişikliği normal giriş noktalarından, sentetik verilerle doğrula. İş kurallarını, veri görünürlüğünü ve erişilebilir geri bildirimi gözden geçir. | Dosya ve gözlemle desteklenen bulgular, düzeltmeden sonra tekrar test |
| Orkestratör | Sözleşmeleri eşleştir, değişiklikleri birleştir, tam testi ve derlemeyi çalıştır, özellikleri ayrı commitlerle gönder. | Doğrulanmış Git revizyonu ve kalan sınırlamalar |

Birden fazla model kullanıldığında rolü ve denetimi işin gerektirdiği yeteneğe göre dağıtın. Bağımsız incelemeci kendi yazdığı özelliğin tek onaylayıcısı olmamalı. Agent işlerini ve commitleri aynı dosyada eşzamanlı yazacak şekilde paylaştırmayın.

## Birleştirme

- Rezervasyonu değiştiren işler için [.agents/skills/randevu-degisikligini-incele/SKILL.md](.agents/skills/randevu-degisikligini-incele/SKILL.md) içindeki senaryoları kullanın.
- Gerçek müşteri bilgilerini, yerel veritabanını veya gizli anahtarları repoya ve test çıktılarına eklemeyin.
- Her davranış değişikliğini açıklayıcı bir committe toplayın. Örneğin `feat(booking): prevent overlapping barber appointments`. Test ve derleme sonuçlarından sonra hedef daldaki SHA'yı kontrol edin.
