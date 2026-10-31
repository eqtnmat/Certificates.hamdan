# مكتب الشهادات والتوصيات

بوابة الطلاب لطلب شهادات التقدير ورسائل التوصية، على Cloudflare Workers + D1.

- `src/index.js` — الـ Worker (الصفحة + الـ API). يُبنى من `source/` عبر `python3 build.py`.
- `wrangler.toml` — اسم الـ Worker وربط قاعدة البيانات `certs-office` باسم `DB`.
- `schema.sql` — جداول قاعدة البيانات (منشأة مسبقاً).

لوحة المرشد في Claude وتقرأ نفس قاعدة البيانات.
