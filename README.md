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
- Türkiye telefon numaraları `+90` biçiminde saklanır. Numara biçimi kontrol edilir. İsteğe bağlı SMS hatırlatmaları için sağlayıcı ve zamanlayıcı kurulur. Telefon sahipliği doğrulanmaz.
- Müşteri adı ve telefonu randevu kaydında tutulur. Müsaitlik ve onay yanıtları bu bilgileri içermez. İptal işlemi kaydı ve iletişim bilgilerini veritabanında bırakır.

## Salon kurulumu

Demo salonla deneme yaparken örnek müşteri bilgileri kullanın. Yeni bir dükkân için aynı kod sürümünü ayrı bir veritabanı ve ayrı işletme parolasıyla kurun. Barındırılan kurulumda yeni D1 veritabanını `DB` olarak bağlayın ve [drizzle/](drizzle/) altındaki şema geçişlerini uygulayın.

İlk açılışta [varsayılan salon profili](server/config.mjs) yüklenir. Telefonda `/isletme` adresinden giriş yapıp **Salon ayarları** bölümünü açın. Salonun görünen adını, konumunu ve açıklamasını girin. Gerçek salon kurulumunda demo bilgisini kapatın. İşletmeye özel görseller dağıtıma `public/media/` altında eklenir. Kaydedilen salon profili o kurulumun veritabanında tutulur ve yayımlanan kod güncellemelerinde korunur.

Hizmetin fiyatını ve süresini belirleyin, çalışanı ekleyip yapabildiği hizmetleri ve haftalık saatlerini tanımlayın. Öğle arasını iki çalışma aralığı arasında boşluk bırakarak girin. Tek bir güne özel izin için ajandada saat kapatın. Önceden onaylanan randevunun ücreti ve ayırdığı süre korunur. Bir vardiya değişikliği veya pasife alma mevcut randevuyu geçersiz kılacaksa panel çakışan saati bildirir.

Müşteri kaydı açmadan önce HTTPS'yi doğrulayın, veritabanı ve yedek erişimlerini sınırlandırın. Müşteriye gösterilecek aydınlatma metnini ve kayıtların saklama ve silme sürecini işletmeyle belirleyin. Gerçek müşteri verisini ve gizli anahtarları repoya eklemeyin.

## Telefonda işletme paneli

`/isletme` adresini açıp tarayıcı menüsünden ana ekrana ekleyebilirsiniz. Günü ve berberi seçerek ajandayı görüntüleyin, gelen müşteriyi kaydedin, mola veya izin aralığı ayırın ve randevu iptal edin. Tüm işlemler müşteri takvimiyle aynı veritabanını kullanır.

Özel ChatGPT Sites demosunda site sahibinin platform tarafından doğrulanan kimliği, sunucudaki gizli `OWNER_EMAIL` ayarıyla eşleştirilir. Oturum açılmamışsa paneldeki “ChatGPT ile giriş yap” bağlantısını kullanın. Oturum açıldıktan sonra aynı panele dönülür. Farklı bir hesapla giriş yapan ziyaretçinin ajandaya erişimi reddedilir. `SITES_MANAGED_IDENTITY=enabled` ayarını yalnızca kimlik başlıklarını doğrulayan Sites dağıtımında kullanın. Yerel veya bağımsız sunucuda en az 16 karakterlik gizli `OWNER_PASSWORD` ortam değişkenini tanımlayıp sunucuyu başlatın. Parola ile girişte oturum 12 saat sürer. Bağımsız sunucularda platform kimlik başlıklarına güvenilmez.

## Müşteri iptali ve hatırlatmalar

Onay fişindeki kişisel bağlantı randevuyu görüntüler. Müşteri randevu başlamadan önce iptalini onayladığında saat yeniden açılır. Bağlantıyı alan kişi iptal edebileceği için bağlantıyı özel tutun. SMS gönderimi isteğe bağlıdır. [Sağlayıcı ve zamanlayıcı kurulumu](docs/sms.md).

[Tasarım notları](docs/design.md) · [Güvenlik ve müşteri verisi](docs/security.md) · [Repo çalışma kuralları](AGENTS.md)
