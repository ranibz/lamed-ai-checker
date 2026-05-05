// netlify/functions/analyze.js
// גרסה: 1.5.0 | תאריך: 2026-05-04 | תיקון: Retry אוטומטי כשמתקבל MAX_TOKENS - ניסיון שני עם פרומפט מקוצר. הסרת maxOutputTokens (Gemini 2.5 Flash תומך ב-65K). הודעת שגיאה ברורה לתלמיד.
// פונקציה שרצה בשרת Netlify - מסתירה את ה-API key ושולחת בקשה ל-Gemini

const FUNCTION_VERSION = '1.5.0';

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

        // ה-prompt לג'מיני - בנוי מ-3 חלקים
        const promptIntro = `אתה מומחה לזיהוי תוכן שנכתב על ידי בינה מלאכותית בעברית. עליך לנתח את הטקסט הבא שהוגש על ידי תלמיד בעבודת חקר.

⚠️ הקשר חשוב על התלמיד:
התלמיד הוא תלמיד תקשורת בתיכון, ובעבודת החקר שלו הוא **חייב** להשתמש במושגים מקצועיים מתחום לימודי התקשורת (כגון: מסגור, הבניית מציאות, ספירלת השתיקה, סדר יום, דנוטציה וקונוטציה, סטריאוטיפים, אושיות רשת, ועוד מושגים אקדמיים בתחום).
**שימוש במושגים מקצועיים אלה הוא דרישה של המטלה ואינו סימן לכתיבת AI.** נהפוך הוא - תלמיד שלא משתמש במושגים מקצועיים זה דבר חשוד יותר.
התמקד בסימנים אחרים שמרמזים על AI: סגנון אחיד מדי, היעדר מוחלט של טעויות, חוסר בקול אישי או דעה אישית, מבנה משפטים "מושלם" מדי, היעדר דוגמאות אישיות או קונקרטיות מחיי התלמיד, חזרתיות, פסקאות סגורות וממוסגרות מדי שלא נשמעות טבעיות לתלמיד תיכון.`;

        let promptCriterion = '';
        // אם הוגדר מחוון - הוסף הערכת מחוון
        if (criterion && criterion.name) {
            promptCriterion = `

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

        const buildFullPrompt = (concise = false) => {
            const conciseNote = concise
                ? `\n\n⚡ חשוב: השב בקצרה ובתמציתיות. לכל שדה תן תשובה קצרה ועניינית - לא יותר משורה אחת לכל פריט. אל תרחיב.`
                : '';

            return promptIntro + promptCriterion + conciseNote + `

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
        };

        // ===== v1.5.0: פונקציית קריאה ל-Gemini עם תמיכה ב-retry =====
        const callGemini = async (concise = false) => {
            const prompt = buildFullPrompt(concise);
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

            const response = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        // הסרנו maxOutputTokens - Gemini 2.5 Flash מאפשר עד 65K, נשאיר ברירת מחדל
                        responseMimeType: "application/json"
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[analyze] Gemini HTTP error (concise=${concise}):`, errText);
                return { httpError: true, errText, status: response.status };
            }

            const data = await response.json();
            const candidate = data?.candidates?.[0];
            const responseText = candidate?.content?.parts?.[0]?.text;
            const finishReason = candidate?.finishReason;

            console.log(`[analyze] Gemini response (concise=${concise}): finishReason=${finishReason}, textLength=${responseText?.length || 0}`);

            return { responseText, finishReason, raw: data };
        };

        // ניסיון ראשון - פרומפט מלא
        let geminiResult = await callGemini(false);

        // אם יש שגיאת HTTP - מחזירים מיד
        if (geminiResult.httpError) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'שגיאה בתקשורת עם שירות הניתוח',
                    details: geminiResult.errText.substring(0, 200)
                })
            };
        }

        // אם נחתך ב-MAX_TOKENS - ננסה שוב עם פרומפט מקוצר
        if (geminiResult.finishReason === 'MAX_TOKENS') {
            console.log('[analyze] First attempt hit MAX_TOKENS - retrying with concise prompt');
            geminiResult = await callGemini(true);

            if (geminiResult.httpError) {
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: 'שגיאה בתקשורת עם שירות הניתוח (ניסיון שני)',
                        details: geminiResult.errText.substring(0, 200)
                    })
                };
            }
        }

        const { responseText, finishReason } = geminiResult;
        // ===== סוף שינוי v1.5.0 =====

        if (!responseText) {
            console.error('[analyze] Empty response from Gemini:', JSON.stringify(geminiData).substring(0, 500));
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'לא התקבלה תשובה תקינה' })
            };
        }

        // בדיקה אם התשובה נחתכה באמצע (אחרי שכבר ניסינו retry במקרה של MAX_TOKENS)
        if (finishReason && finishReason !== 'STOP') {
            console.error(`[analyze] Gemini stopped abnormally even after retry: ${finishReason}`);
            
            const reasonMessages = {
                'MAX_TOKENS': 'הניתוח לא הושלם בגלל אורך התשובה. אנא נסה לקצר את הטקסט (עד 5,000 תווים) ונסה שוב.',
                'SAFETY': 'התשובה נחסמה מטעמי בטיחות',
                'RECITATION': 'התשובה נחסמה בגלל חשד להעתקה',
                'OTHER': 'הניתוח הופסק - אנא נסה שוב'
            };
            
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: reasonMessages[finishReason] || `הניתוח הופסק (${finishReason}) - אנא נסה שוב`,
                    finishReason
                })
            };
        }

        // ניסיון לפרסר את ה-JSON
        let analysis;
        try {
            // ניקוי - אם יש markdown code blocks (גם אם responseMimeType מגדיר JSON, לפעמים זה קורה)
            let cleaned = responseText
                .replace(/```json\s*/g, '')
                .replace(/```\s*$/g, '')
                .trim();
            
            // אם עדיין יש טקסט מסביב ל-JSON - חילוץ עמיד יותר
            if (!cleaned.startsWith('{')) {
                const firstBrace = cleaned.indexOf('{');
                const lastBrace = cleaned.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                    console.log('[analyze] Extracted JSON from surrounding text');
                }
            }
            
            analysis = JSON.parse(cleaned);
        } catch (parseErr) {
            console.error('[analyze] Parse error:', parseErr.message);
            console.error('[analyze] Raw response (first 1000 chars):', responseText.substring(0, 1000));
            console.error('[analyze] Raw response (last 500 chars):', responseText.substring(Math.max(0, responseText.length - 500)));
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'התשובה התקבלה אבל לא בפורמט הנכון',
                    raw: responseText.substring(0, 500),
                    parseError: parseErr.message
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
