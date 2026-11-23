# BerberRandevuApp

Bağımsız berber salonları için Türkçe randevu uygulaması. Örnek salon, Moda'daki kurgusal Makas'tır. Müşteri bir veya birden fazla hizmet seçer, uygun bir berber ile boş bir saat bulur ve adını, telefonunu girerek randevu kodu alır.

## Yerelde çalıştırma

Node.js 24 veya üzeri gerekir. Çalışma zamanı bağımlılıkları Node.js ile gelir.

```sh
npm start
npm test
npm run build
```

`npm start` ve `npm run dev` uygulamayı [http://127.0.0.1:4173](http://127.0.0.1:4173) adresinde açar. `HOST` ve `PORT` bu adresi değiştirir. Uygulama ilk açılışta `data/bookings.sqlite` dosyasını oluşturur ve şema geçişlerini uygular. `BOOKING_DATABASE` ile başka bir SQLite dosyası seçilebilir. İstek sınırı için kullanılan `RATE_LIMIT_SECRET` isteğe bağlıdır. Boş bırakıldığında uygulama bir anahtar üretip veritabanında saklar.

`npm test` geçici veritabanlarıyla çalışır. `npm run build`, barındırılan sürüm için `dist/server/index.js` giriş noktasını ve `dist/.openai/drizzle/` altındaki şema geçişlerini hazırlar.

## Randevuları işletmek

Komutlar yerel SQLite veritabanını kullanır. Sunucuyu özel bir `BOOKING_DATABASE` yolu ile başlattıysanız komutları da aynı ortam değişkeniyle çalıştırın.

```sh
npm run bookings -- list
npm run bookings -- list 2026-12-01
npm run bookings -- cancel MKS-ABCDEF012345
```

`list` varsayılan olarak İstanbul'daki bugünün etkin randevularını müşteri adı ve telefonuyla birlikte gösterir. `cancel` randevuyu iptal olarak işaretler ve saati tekrar müsait kılar. Barındırılan sürüm `DB` bağlantısı üzerinden ayrı bir Cloudflare D1 veritabanı kullanır. Yerel SQLite dosyası ile D1 arasında eşitleme yoktur. Barındırılan randevuları yetkili D1 erişimi olan işletmeci yönetir.

## Randevu kuralları

- Saatler `Europe/Istanbul` saat dilimindedir. Bugünden 30 gün sonrasına kadar, son gün dahil, randevu alınabilir. Saatler 15 dakikalık adımlarla sunulur. Seçilen hizmetlerin toplam süresi berberin molalarına ve mevcut randevularına denk gelmeden vardiyaya sığmalıdır.
- Türkiye telefon numaraları `+90` biçiminde saklanır. Numara biçimi kontrol edilir. Telefon sahipliği doğrulaması ve SMS gönderimi sürümde yer almıyor.
- Müşteri adı ve telefonu randevu kaydında tutulur. Müsaitlik ve onay yanıtları bu bilgileri içermez. İptal işlemi kaydı ve iletişim bilgilerini veritabanında bırakır.

## Salon kurulumu

Demoyu denerken örnek müşteri bilgileri kullanın. Gerçek müşteri kaydına başlamadan önce her salon için ayrı bir kurulum ve veritabanı oluşturun. Salon kimliğini, hizmetleri, TL fiyatlarını, süreleri, berberleri ve vardiyaları [server/config.mjs](server/config.mjs) üzerinden düzenleyin. [public/index.html](public/index.html) içindeki salon metinlerini ve [temsili salon görselini](public/media/salon.webp) kendi içeriklerinizle güncelleyin. Barındırılan kurulumda yeni D1 veritabanını `DB` olarak bağlayın ve [drizzle/](drizzle/) şema geçişlerini uygulayın.

Müşteri kaydı açmadan önce HTTPS'yi doğrulayın, veritabanı ve yedek erişimlerini sınırlandırın. Müşteriye gösterilecek aydınlatma metnini ve kayıtların saklama ve silme sürecini işletmeyle belirleyin. Gerçek müşteri verisini ve gizli anahtarları repoya eklemeyin.

Sonraki sürüm için iki öncelik, yetkili salon yönetim ekranında randevu görüntüleme ve iptal ile müşteriye randevu hatırlatmasıdır.

[Tasarım notları](docs/design.md) · [Güvenlik ve müşteri verisi](docs/security.md) · [Repo çalışma kuralları](AGENTS.md)
