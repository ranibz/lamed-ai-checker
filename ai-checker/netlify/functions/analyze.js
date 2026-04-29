// netlify/functions/analyze.js
// גרסה: 1.4.1 | תאריך: 2026-04-29 | תיקון: maxOutputTokens 4096→8192 (תשובות חתוכות עם מחוון)
// פונקציה שרצה בשרת Netlify - מסתירה את ה-API key ושולחת בקשה ל-Gemini

const FUNCTION_VERSION = '1.4.1';

// פונקציית עזר - שמירת רישום ב-Supabase
async function logToSupabase(data) {
    try {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_KEY;
        
        if (!SUPABASE_URL || !SUPABASE_KEY) {
            console.log('[log] Supabase not configured, skipping');
            return;
        }
        
        const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_checker_logs`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            console.error('[log] Supabase error:', res.status, await res.text());
        } else {
            console.log('[log] Logged to Supabase successfully');
        }
    } catch (err) {
        console.error('[log] Failed to log:', err.message);
    }
}

exports.handler = async (event, context) => {
    console.log(`[analyze] v${FUNCTION_VERSION} invoked`);
    const startTime = Date.now();
    
    // איסוף מידע על הבקשה
    const ipAddress = event.headers['x-forwarded-for']?.split(',')[0]?.trim() 
        || event.headers['client-ip'] 
        || 'unknown';
    const userAgent = event.headers['user-agent'] || 'unknown';
    
    // הגדרת CORS - מאפשר גישה מהדפדפן
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // טיפול ב-OPTIONS (preflight)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // רק POST מותר
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { text, criterion } = JSON.parse(event.body || '{}');

        // ולידציות
        if (!text || typeof text !== 'string') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'יש להזין טקסט לניתוח' })
            };
        }

        if (text.length < 50) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'הטקסט קצר מדי - יש להזין לפחות 50 תווים' })
            };
        }

        if (text.length > 10000) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'הטקסט ארוך מדי - מקסימום 10,000 תווים' })
            };
        }

        // קבלת המפתח ממשתני סביבה - בטוח, לא חשוף לדפדפן
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'שגיאה: חסר API key במערכת' })
            };
        }

        // ה-prompt לג'מיני
        let prompt = `אתה מומחה לזיהוי תוכן שנכתב על ידי בינה מלאכותית בעברית. עליך לנתח את הטקסט הבא שהוגש על ידי תלמיד בעבודת חקר.

⚠️ הקשר חשוב על התלמיד:
התלמיד הוא תלמיד תקשורת בתיכון, ובעבודת החקר שלו הוא **חייב** להשתמש במושגים מקצועיים מתחום לימודי התקשורת (כגון: מסגור, הבניית מציאות, ספירלת השתיקה, סדר יום, דנוטציה וקונוטציה, סטריאוטיפים, אושיות רשת, ועוד מושגים אקדמיים בתחום).
**שימוש במושגים מקצועיים אלה הוא דרישה של המטלה ואינו סימן לכתיבת AI.** נהפוך הוא - תלמיד שלא משתמש במושגים מקצועיים זה דבר חשוד יותר.
התמקד בסימנים אחרים שמרמזים על AI: סגנון אחיד מדי, היעדר מוחלט של טעויות, חוסר בקול אישי או דעה אישית, מבנה משפטים "מושלם" מדי, היעדר דוגמאות אישיות או קונקרטיות מחיי התלמיד, חזרתיות, פסקאות סגורות וממוסגרות מדי שלא נשמעות טבעיות לתלמיד תיכון.`;

        // אם הוגדר מחוון - הוסף הערכת מחוון
        if (criterion && criterion.name) {
            prompt += `

📋 בנוסף - **הערכה לפי מחוון**:
התלמיד ענה על הסעיף הבא במחוון של עבודת החקר בלמ"ד:

**פרק:** ${criterion.chapter || 'לא צוין'}
**שם הסעיף:** ${criterion.name}
**מקסימום נקודות:** ${criterion.max_points || 'לא צוין'}
**תיאור הסעיף:** ${criterion.description || 'לא צוין'}

עליך גם להעריך את התשובה ביחס לדרישות הסעיף הזה:
1. האם התלמיד התייחס לכל הדרישות של הסעיף?
2. איכות התשובה לעומת המצופה
3. הצעת ציון לפי משקל הסעיף`;
        }

        prompt += `

הטקסט לבדיקה:
"""
${text}
"""

אנא ספק ניתוח מפורט בפורמט JSON בלבד (ללא טקסט נוסף לפני או אחרי):

{
  "ai_likelihood": <מספר 0-100, ההסתברות שהטקסט נכתב על ידי AI>,
  "verdict": "<אחד מהבאים: 'human' (סביר אנושי), 'mixed' (שילוב), 'ai' (סביר AI), 'definitely_ai' (כמעט בוודאות AI)>",
  "summary": "<משפט אחד מסכם בעברית - מה הרושם הכללי>",
  "ai_indicators": [
    "<סימן ראשון שמרמז על AI - בעברית, משפט קצר. אל תכלול שימוש במושגים מקצועיים כי זה נדרש>",
    "<סימן שני>",
    "<סימן שלישי>"
  ],
  "human_indicators": [
    "<סימן שמרמז על כתיבה אנושית, אם יש - בעברית>",
    "<סימן נוסף, אם יש>"
  ],
  "questions_for_student": [
    "<שאלה 1 לבוחן לשאול את התלמיד כדי לוודא הבנה - בעברית, ספציפית לטקסט>",
    "<שאלה 2 - דורשת ידע מעמיק שאי אפשר להמציא מהטקסט>",
    "<שאלה 3 - מבקשת דוגמה אישית או הקשר אישי>",
    "<שאלה 4 - בודקת הבנת מונחים מסוימים מהטקסט>",
    "<שאלה 5 - מאתגרת, גורמת לתלמיד להסביר במילים שלו>"
  ]${criterion && criterion.name ? `,
  "rubric_evaluation": {
    "overall_status": "<'complete' (התייחס לכל הדרישות), 'partial' (חלקי), 'incomplete' (לא מספיק)>",
    "suggested_score": <מספר 0 עד ${criterion.max_points || 10}, הצעת ציון לסעיף>,
    "max_points": ${criterion.max_points || 10},
    "what_was_covered": [
      "<דרישה 1 שהתלמיד כיסה היטב>",
      "<דרישה 2 שכוסתה>"
    ],
    "what_was_missing": [
      "<דרישה 1 שחסרה או חלקית>",
      "<דרישה 2 שחסרה>"
    ],
    "improvement_suggestions": [
      "<הצעה 1 איך לשפר את התשובה - ספציפי>",
      "<הצעה 2>",
      "<הצעה 3>"
    ],
    "explanation": "<פסקה אחת בעברית - הסבר כללי על ההערכה ועל הציון המוצע>"
  }` : ''}
}

חשוב מאוד:
1. הוצא רק JSON תקין - בלי שום טקסט מסביב
2. השתמש בעברית לכל הערכים בתוך ה-JSON
3. השאלות חייבות להיות ספציפיות לטקסט שניתן - לא שאלות גנריות
4. אל תוריד ניקוד בגלל שימוש במושגים מקצועיים בתחום התקשורת - זה נדרש מהתלמיד.
5. בהערכת מחוון - היה הוגן וענייני, התייחס לדרישות הספציפיות של הסעיף.`;

        // קריאה ל-Gemini API
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 8192,
                    responseMimeType: "application/json"
                }
            })
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error('Gemini error:', errText);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'שגיאה בתקשורת עם שירות הניתוח',
                    details: errText.substring(0, 200)
                })
            };
        }

        const geminiData = await geminiResponse.json();

        // חילוץ הטקסט מהתגובה
        const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'לא התקבלה תשובה תקינה' })
            };
        }

        // ניסיון לפרסר את ה-JSON
        let analysis;
        try {
            // ניקוי - אם יש markdown code blocks
            const cleaned = responseText
                .replace(/```json\s*/g, '')
                .replace(/```\s*$/g, '')
                .trim();
            analysis = JSON.parse(cleaned);
        } catch (parseErr) {
            console.error('Parse error:', parseErr, 'Raw:', responseText);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'התשובה התקבלה אבל לא בפורמט הנכון',
                    raw: responseText.substring(0, 500)
                })
            };
        }

        // תיעוד ב-Supabase
        await logToSupabase({
            ai_likelihood: analysis.ai_likelihood || null,
            verdict: analysis.verdict || null,
            text_length: text.length,
            ip_address: ipAddress,
            user_agent: userAgent.substring(0, 200),
            duration_ms: Date.now() - startTime,
            success: true
        });

        // החזרה למשתמש
        return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...analysis, _version: FUNCTION_VERSION })
        };

    } catch (err) {
        console.error('Function error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'שגיאה לא צפויה: ' + err.message })
        };
    }
};
