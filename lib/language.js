export const SUPPORTED_LANGUAGES = Object.freeze(["ru", "en", "lv"]);

const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);

export function normalizeLanguage(value) {
  if (typeof value !== "string") {
    return null;
  }

  const language = value.trim().toLowerCase().split("-")[0];
  return SUPPORTED_LANGUAGE_SET.has(language) ? language : null;
}

export function isSupportedLanguage(value) {
  return typeof value === "string" && SUPPORTED_LANGUAGE_SET.has(value);
}

export function languageFromAcceptLanguage(header, fallback = "ru") {
  if (typeof header === "string") {
    for (const item of header.split(",")) {
      const language = normalizeLanguage(item.split(";")[0]);
      if (language) {
        return language;
      }
    }
  }

  return normalizeLanguage(fallback) || "ru";
}

const SERVER_MESSAGES = {
  ru: {
    METHOD_NOT_ALLOWED: "Используйте POST-запрос.",
    BODY_TOO_LARGE: "Запрос слишком большой.",
    INVALID_BODY: "Не удалось прочитать запрос.",
    INVALID_JSON: "Некорректный формат запроса.",
    UNSUPPORTED_MEDIA_TYPE: "Отправьте запрос в формате JSON.",
    CROSS_SITE_REQUEST: "Запрос с другого сайта заблокирован.",
    UNSUPPORTED_LANGUAGE: "Выберите русский, английский или латышский язык.",
    TOO_MANY_REQUESTS: ({ seconds }) =>
      `Слишком много запросов. Повторите через ${seconds} сек.`,
    INVALID_YOUTUBE_URL: "Вставьте ссылку на один ролик YouTube, Shorts или Live.",
    SERVICE_NOT_CONFIGURED: "Сервис ещё не подключён к API. Сообщите владельцу сайта.",
    UNEXPECTED_ERROR: "Произошла непредвиденная ошибка. Попробуйте позже.",
    APIFY_TIMEOUT: "YouTube слишком долго отвечал. Попробуйте ещё раз через минуту.",
    APIFY_UNAVAILABLE: "Не удалось связаться с сервисом транскриптов. Попробуйте позже.",
    APIFY_CONFIGURATION: "Сервис транскриптов временно не настроен. Сообщите владельцу сайта.",
    APIFY_RATE_LIMIT: "Лимит получения транскриптов временно исчерпан. Попробуйте позже.",
    APIFY_ERROR: "Не удалось получить транскрипт этого видео.",
    APIFY_BAD_RESPONSE: "Сервис транскриптов вернул некорректный ответ.",
    TRANSCRIPT_NOT_FOUND:
      "У ролика нет доступных субтитров или видео закрыто. Выберите публичный ролик с субтитрами.",
    GEMINI_TIMEOUT: "Анализ занял слишком много времени. Попробуйте ещё раз.",
    GEMINI_UNAVAILABLE: "Не удалось связаться с AI-моделью. Попробуйте позже.",
    GEMINI_BAD_RESPONSE: "AI-модель вернула некорректный ответ.",
    GEMINI_EMPTY_RESPONSE: "AI-модель вернула пустой ответ.",
    GEMINI_RATE_LIMIT:
      "Все доступные AI-модели достигли бесплатного лимита. Повторите попытку позже.",
    GEMINI_BUSY: "AI-модели временно перегружены. Повторите через минуту.",
    GEMINI_ERROR: "AI-модель не смогла выполнить анализ. Попробуйте другой ролик.",
    AUTH_REQUIRED: "Войдите или зарегистрируйтесь, чтобы анализировать видео.",
    INVALID_EMAIL: "Введите корректный адрес электронной почты.",
    INVALID_PASSWORD: "Пароль должен содержать от 8 до 128 символов.",
    INVALID_CREDENTIALS: "Неверная электронная почта или пароль.",
    EMAIL_ALREADY_REGISTERED: "Пользователь с такой электронной почтой уже зарегистрирован.",
    WEAK_PASSWORD: "Пароль слишком простой. Используйте не менее 8 символов.",
    AUTH_RATE_LIMIT: "Слишком много попыток входа. Попробуйте немного позже.",
    REGISTRATION_FAILED: "Не удалось зарегистрироваться. Проверьте данные и попробуйте снова.",
    EMAIL_CONFIRMATION_ENABLED:
      "Регистрация временно не настроена. Владельцу сайта нужно отключить подтверждение email в Supabase.",
    AUTH_TEMPORARY_ERROR: "Сервис входа временно недоступен. Попробуйте позже.",
    DATABASE_TEMPORARY_ERROR: "Сервис временно не смог сохранить данные. Попробуйте позже.",
    NO_CREDITS: "Сегодняшние 10 кредитов использованы. Баланс восстановится в полночь по Риге.",
    INVALID_REQUEST_ID: "Не удалось создать безопасный номер запроса. Обновите страницу.",
    DUPLICATE_REQUEST: "Этот запрос уже обработан. Запустите новый анализ.",
    INVALID_JOB_ID: "Не удалось определить задание анализа. Обновите страницу.",
    JOB_NOT_FOUND: "Анализ не найден или уже удалён.",
    JOB_EXPIRED: "Незавершённый анализ устарел. Запустите его ещё раз.",
    COST_GUARD_REACHED: "Дневной бесплатный лимит новых анализов достигнут. Сохранённые результаты продолжают работать.",
    SHARE_NOT_FOUND: "Публичная ссылка недействительна, отозвана или устарела.",
    PDF_EXPORT_FAILED: "Не удалось подготовить PDF. Попробуйте ещё раз.",
    CAPTCHA_REQUIRED: "Подтвердите, что вы не робот.",
    CAPTCHA_FAILED: "Проверка безопасности не пройдена. Повторите попытку.",
  },
  en: {
    METHOD_NOT_ALLOWED: "Use a POST request.",
    BODY_TOO_LARGE: "The request is too large.",
    INVALID_BODY: "The request could not be read.",
    INVALID_JSON: "The request format is invalid.",
    UNSUPPORTED_MEDIA_TYPE: "Send the request as JSON.",
    CROSS_SITE_REQUEST: "A request from another site was blocked.",
    UNSUPPORTED_LANGUAGE: "Choose Russian, English, or Latvian.",
    TOO_MANY_REQUESTS: ({ seconds }) =>
      `Too many requests. Try again in ${seconds} sec.`,
    INVALID_YOUTUBE_URL: "Enter a link to one YouTube video, Short, or Live recording.",
    SERVICE_NOT_CONFIGURED: "The API services are not configured yet. Contact the site owner.",
    UNEXPECTED_ERROR: "An unexpected error occurred. Please try again later.",
    APIFY_TIMEOUT: "YouTube took too long to respond. Try again in a minute.",
    APIFY_UNAVAILABLE: "The transcript service could not be reached. Please try again later.",
    APIFY_CONFIGURATION: "The transcript service is not configured correctly. Contact the site owner.",
    APIFY_RATE_LIMIT: "The transcript limit has been reached temporarily. Please try again later.",
    APIFY_ERROR: "The transcript for this video could not be retrieved.",
    APIFY_BAD_RESPONSE: "The transcript service returned an invalid response.",
    TRANSCRIPT_NOT_FOUND:
      "No subtitles are available or the video is private. Choose a public video with subtitles.",
    GEMINI_TIMEOUT: "The analysis took too long. Please try again.",
    GEMINI_UNAVAILABLE: "The AI model could not be reached. Please try again later.",
    GEMINI_BAD_RESPONSE: "The AI model returned an invalid response.",
    GEMINI_EMPTY_RESPONSE: "The AI model returned an empty response.",
    GEMINI_RATE_LIMIT:
      "All available AI models have reached their free limits. Please try again later.",
    GEMINI_BUSY: "The AI models are temporarily overloaded. Try again in a minute.",
    GEMINI_ERROR: "The AI model could not complete the analysis. Try another video.",
    AUTH_REQUIRED: "Sign in or create an account to analyze videos.",
    INVALID_EMAIL: "Enter a valid email address.",
    INVALID_PASSWORD: "The password must contain 8 to 128 characters.",
    INVALID_CREDENTIALS: "The email or password is incorrect.",
    EMAIL_ALREADY_REGISTERED: "An account with this email already exists.",
    WEAK_PASSWORD: "The password is too weak. Use at least 8 characters.",
    AUTH_RATE_LIMIT: "Too many sign-in attempts. Please try again later.",
    REGISTRATION_FAILED: "Registration failed. Check your details and try again.",
    EMAIL_CONFIRMATION_ENABLED:
      "Registration is not configured yet. The site owner must disable email confirmation in Supabase.",
    AUTH_TEMPORARY_ERROR: "The sign-in service is temporarily unavailable. Please try again later.",
    DATABASE_TEMPORARY_ERROR: "The service could not save the data temporarily. Please try again later.",
    NO_CREDITS: "Today's 10 credits have been used. Your balance resets at midnight in Riga.",
    INVALID_REQUEST_ID: "A secure request ID could not be created. Reload the page.",
    DUPLICATE_REQUEST: "This request has already been processed. Start a new analysis.",
    INVALID_JOB_ID: "The analysis job could not be identified. Reload the page.",
    JOB_NOT_FOUND: "The analysis was not found or has been deleted.",
    JOB_EXPIRED: "The unfinished analysis expired. Start it again.",
    COST_GUARD_REACHED: "The daily free limit for new analyses has been reached. Saved results remain available.",
    SHARE_NOT_FOUND: "The public link is invalid, revoked, or expired.",
    PDF_EXPORT_FAILED: "The PDF could not be prepared. Please try again.",
    CAPTCHA_REQUIRED: "Confirm that you are not a robot.",
    CAPTCHA_FAILED: "The security check failed. Please try again.",
  },
  lv: {
    METHOD_NOT_ALLOWED: "Izmantojiet POST pieprasījumu.",
    BODY_TOO_LARGE: "Pieprasījums ir pārāk liels.",
    INVALID_BODY: "Pieprasījumu neizdevās nolasīt.",
    INVALID_JSON: "Pieprasījuma formāts nav derīgs.",
    UNSUPPORTED_MEDIA_TYPE: "Nosūtiet pieprasījumu JSON formātā.",
    CROSS_SITE_REQUEST: "Pieprasījums no citas vietnes tika bloķēts.",
    UNSUPPORTED_LANGUAGE: "Izvēlieties krievu, angļu vai latviešu valodu.",
    TOO_MANY_REQUESTS: ({ seconds }) =>
      `Pārāk daudz pieprasījumu. Mēģiniet vēlreiz pēc ${seconds} sek.`,
    INVALID_YOUTUBE_URL: "Ievietojiet saiti uz vienu YouTube video, Short vai tiešraides ierakstu.",
    SERVICE_NOT_CONFIGURED: "API pakalpojumi vēl nav konfigurēti. Sazinieties ar vietnes īpašnieku.",
    UNEXPECTED_ERROR: "Radās neparedzēta kļūda. Lūdzu, mēģiniet vēlreiz vēlāk.",
    APIFY_TIMEOUT: "YouTube atbilde aizņēma pārāk ilgu laiku. Mēģiniet vēlreiz pēc minūtes.",
    APIFY_UNAVAILABLE: "Neizdevās sazināties ar transkripta pakalpojumu. Mēģiniet vēlreiz vēlāk.",
    APIFY_CONFIGURATION:
      "Transkripta pakalpojums nav pareizi konfigurēts. Sazinieties ar vietnes īpašnieku.",
    APIFY_RATE_LIMIT: "Transkriptu limits īslaicīgi ir sasniegts. Mēģiniet vēlreiz vēlāk.",
    APIFY_ERROR: "Neizdevās iegūt šī video transkriptu.",
    APIFY_BAD_RESPONSE: "Transkripta pakalpojums atgrieza nederīgu atbildi.",
    TRANSCRIPT_NOT_FOUND:
      "Subtitri nav pieejami vai video ir privāts. Izvēlieties publisku video ar subtitriem.",
    GEMINI_TIMEOUT: "Analīze aizņēma pārāk ilgu laiku. Mēģiniet vēlreiz.",
    GEMINI_UNAVAILABLE: "Neizdevās sazināties ar AI modeli. Mēģiniet vēlreiz vēlāk.",
    GEMINI_BAD_RESPONSE: "AI modelis atgrieza nederīgu atbildi.",
    GEMINI_EMPTY_RESPONSE: "AI modelis atgrieza tukšu atbildi.",
    GEMINI_RATE_LIMIT:
      "Visi pieejamie AI modeļi ir sasnieguši bezmaksas limitu. Mēģiniet vēlreiz vēlāk.",
    GEMINI_BUSY: "AI modeļi pašlaik ir pārslogoti. Mēģiniet vēlreiz pēc minūtes.",
    GEMINI_ERROR: "AI modelis nevarēja pabeigt analīzi. Izmēģiniet citu video.",
    AUTH_REQUIRED: "Pierakstieties vai reģistrējieties, lai analizētu video.",
    INVALID_EMAIL: "Ievadiet derīgu e-pasta adresi.",
    INVALID_PASSWORD: "Parolē jābūt no 8 līdz 128 rakstzīmēm.",
    INVALID_CREDENTIALS: "E-pasts vai parole nav pareiza.",
    EMAIL_ALREADY_REGISTERED: "Konts ar šo e-pastu jau pastāv.",
    WEAK_PASSWORD: "Parole ir pārāk vienkārša. Izmantojiet vismaz 8 rakstzīmes.",
    AUTH_RATE_LIMIT: "Pārāk daudz pierakstīšanās mēģinājumu. Mēģiniet vēlāk.",
    REGISTRATION_FAILED: "Reģistrācija neizdevās. Pārbaudiet datus un mēģiniet vēlreiz.",
    EMAIL_CONFIRMATION_ENABLED:
      "Reģistrācija vēl nav konfigurēta. Vietnes īpašniekam Supabase jāizslēdz e-pasta apstiprināšana.",
    AUTH_TEMPORARY_ERROR: "Pierakstīšanās pakalpojums īslaicīgi nav pieejams. Mēģiniet vēlāk.",
    DATABASE_TEMPORARY_ERROR: "Pakalpojumam īslaicīgi neizdevās saglabāt datus. Mēģiniet vēlāk.",
    NO_CREDITS: "Šodienas 10 kredīti ir izmantoti. Atlikums atjaunosies pusnaktī pēc Rīgas laika.",
    INVALID_REQUEST_ID: "Neizdevās izveidot drošu pieprasījuma numuru. Pārlādējiet lapu.",
    DUPLICATE_REQUEST: "Šis pieprasījums jau ir apstrādāts. Sāciet jaunu analīzi.",
    INVALID_JOB_ID: "Analīzes uzdevumu neizdevās noteikt. Pārlādējiet lapu.",
    JOB_NOT_FOUND: "Analīze nav atrasta vai jau ir dzēsta.",
    JOB_EXPIRED: "Nepabeigtās analīzes termiņš beidzās. Sāciet to vēlreiz.",
    COST_GUARD_REACHED: "Jauno analīžu dienas bezmaksas limits ir sasniegts. Saglabātie rezultāti joprojām darbojas.",
    SHARE_NOT_FOUND: "Publiskā saite nav derīga, ir atsaukta vai tās termiņš beidzies.",
    PDF_EXPORT_FAILED: "PDF neizdevās sagatavot. Mēģiniet vēlreiz.",
    CAPTCHA_REQUIRED: "Apstipriniet, ka neesat robots.",
    CAPTCHA_FAILED: "Drošības pārbaude neizdevās. Mēģiniet vēlreiz.",
  },
};

export function serverMessage(language, code, params = {}) {
  const dictionary = SERVER_MESSAGES[normalizeLanguage(language) || "ru"];
  const value = dictionary[code] ?? dictionary.UNEXPECTED_ERROR;
  return typeof value === "function" ? value(params) : value;
}
