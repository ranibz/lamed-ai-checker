// lamed-angle.js · v1.0.0 · 20/10/2026 · Netlify Function
// מכוון הנושאים למ"ד — מקבל טקסט נושא של תלמיד ומחזיר JSON עם שתי זוויות תקשורתיות לפי מחוון למ"ד תשפ"ו.
// הפרומפט נבנה כאן בשרת (ולא בדפדפן) כדי שהפונקציה לא תשמש כממשק פתוח ל-Gemini.
// משתמש באותו מפתח Gemini של analyze.js (משתנה סביבה GEMINI_API_KEY).
// פיתוח: רני בן זאב

const MODEL = 'gemini-2.5-flash';

const RUBRIC = `מחוון למ"ד (למידה מבוססת דילמות) תשפ"ו — עבודת גמר 5 יח"ל במגמת תקשורת:
פרק 1 מבוא (10): רקע כללי על הנושא (3), רלוונטיות הנושא (3), הצגת מכלול העבודה (2), פרומו (2).
פרק 2 רקע תיאורטי (15): סקירה אקדמית של שני מאמרים (5), 10 מושגים (10), ביבליוגרפיה.
פרק 3 מתודולוגיה וחקר (10): מתודולוגיית החקר (1), ביצוע החקר (6), הצגת ממצאים (3).
פרק 4 סיכום ודיון בדילמות (15): סיכום ומסקנות (3), אוריינות תקשורתית (2), אוריינות אזרחית (2), דיון בדילמות הנובעות מהחקר (8).
פרק 5 הגנה (50).`;

const SCHEMA_HINT = `{
 "topic_short": "ניסוח קצר של הנושא המקורי (עד 8 מילים)",
 "already_media": true/false,
 "verdict": "משפט אחד: עד כמה הנושא כבר תקשורתי ומה חסר",
 "angles": [ // בדיוק 2 זוויות
  {
   "title": "שם הזווית (עד 8 מילים)",
   "pitch": "2-3 משפטים: איך הנושא המקורי הופך לשאלה תקשורתית בלי לאבד את מה שסקרן את התלמיד",
   "research_question": "שאלת חקר אחת, ממוקדת ונחקרת",
   "concepts": [{"he":"מונח בעברית כפי שנאמר בתחום","en":"English term","why":"איך הוא משמש בעבודה, חצי משפט"}], // בדיוק 10
   "articles": ["כיוון/נושא של מאמר אקדמי לחיפוש + מילות חיפוש באנגלית לגוגל סקולר"], // 2 פריטים. אל תמציא שמות מחברים או כותרות מאמרים
   "method": {"type":"שם השיטה","corpus":"מה בדיוק נאסף/נחקר ובאיזה היקף ריאלי לתלמיד תיכון","steps":["צעד","צעד","צעד"]},
   "media_literacy": "משפט: מה הקורא/הצופה ילמד על האופן שבו התקשורת עובדת",
   "civic_literacy": "משפט: ההשלכה על החברה, הדמוקרטיה או הציבור",
   "dilemmas": [{"q":"ניסוח הדילמה כשאלה","sides":"שני הצדדים בקצרה"}] // 2 דילמות
  }
 ],
 "tip": "טיפ אחד למורה לשיחה עם התלמיד"
}`;

function buildPrompt(text){
  return `אתה מנחה ותיק של עבודות גמר במגמת תקשורת בתיכון בישראל. תלמיד בחר נושא שמסקרן אותו לעבודת למ"ד. התפקיד שלך: לכוון את הנושא לזווית תקשורתית שתאפשר לו לעמוד במחוון, תוך שמירה על מה שמעניין אותו בנושא המקורי.

${RUBRIC}

כללים:
- הזווית חייבת לאפשר שני מאמרים אקדמיים בתחום התקשורת ו-10 מושגים מתורת התקשורת (למשל סדר יום, מסגור, שומרי סף, תאוריית הטיפוח, בועת סינון, ייצוג, סטריאוטיפ, אינפלואנסרים, אלגוריתם, פייק ניוז, מוסר עיתונאי, השפעת תקשורת וכו'). העדף מושגים שמופיעים בתוכנית הלימודים של מגמת תקשורת בישראל.
- מושגים: כתוב את המונח כפי שהוא נאמר בפועל בתחום בעברית, והאנגלית בשדה en. לא תרגום מילולי.
- שיטת החקר חייבת להיות ריאלית לתלמיד תיכון בכמה שבועות: ניתוח תוכן של כתבות/פוסטים/סרטונים, סקר, ראיונות עומק, קבוצת מיקוד או השוואה בין כלי תקשורת.
- הדילמות צריכות לנבוע מהחקר עצמו ולהיות דילמות אמיתיות (שני צדדים לגיטימיים).
- אם הנושא כבר תקשורתי: הזווית הראשונה מחדדת אותו, השנייה מציעה כיוון חלופי. אם לא: שתי זוויות שונות זו מזו.
- אל תמציא שמות מאמרים, מחברים או נתונים. במאמרים תן כיוון ומילות חיפוש.
- כתוב בעברית תקנית, בלשון ברורה למורה.

הנושא כפי שהתלמיד כתב:
"""
${text}
"""

החזר JSON בלבד, ללא טקסט נוסף, במבנה הזה:
${SCHEMA_HINT}`;
}

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST בלבד' }) };

  const key = process.env.GEMINI_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'חסר GEMINI_API_KEY בהגדרות האתר ב-Netlify' }) };

  let text = '';
  try { text = String(JSON.parse(event.body || '{}').text || '').trim(); } catch (e) {}
  if (text.length < 4) return { statusCode: 400, headers, body: JSON.stringify({ error: 'חסר טקסט נושא' }) };
  if (text.length > 4000) text = text.slice(0, 4000);

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(text) }] }],
        generationConfig: { temperature: 0.6, responseMimeType: 'application/json' }
      })
    });
    const data = await res.json();
    if (!res.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: 'Gemini: ' + (data.error?.message || res.status) }) };
    const raw = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    let out;
    try { out = JSON.parse(raw); }
    catch (e) { const m = raw.match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : null; }
    if (!out || !Array.isArray(out.angles)) return { statusCode: 502, headers, body: JSON.stringify({ error: 'התשובה הגיעה במבנה לא צפוי. נסו שוב.' }) };
    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
