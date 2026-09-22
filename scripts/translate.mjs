const DEEPL_KEY = process.env.DEEPL_API_KEY;

export async function translateToTurkish(text) {
  if (!DEEPL_KEY || !text) return null;
  try {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: [text], target_lang: 'TR', source_lang: 'DE' }),
    });
    if (!res.ok) {
      console.error('DeepL hata:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.translations?.[0]?.text ?? null;
  } catch (err) {
    console.error('Çeviri başarısız:', err.message);
    return null;
  }
}
