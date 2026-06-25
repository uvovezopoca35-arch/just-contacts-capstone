'use client';

/**
 * Lightweight i18n for the Just Contacts mini-app.
 *
 * - Language is auto-detected from Telegram (initDataUnsafe.user.language_code):
 *   anything starting with "ru" → Russian, everything else → English.
 * - A manual choice (the switch on the home screen) is persisted to localStorage
 *   and always wins over auto-detection.
 * - Strings live in nested dictionaries; dynamic strings are functions.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { getTelegramUser } from '@/lib/telegram';

export type Lang = 'ru' | 'en';

const STORAGE_KEY = 'jc_lang';

// ─────────────────────────── Dictionaries ───────────────────────────

const ru = {
  common: {
    loading: 'Загрузка...',
    error: 'Ошибка',
    save: 'Сохранить',
    add: 'Добавить',
    collapse: 'Свернуть',
    rateLimit: 'Слишком много запросов. Подождите минуту.',
  },
  nav: {
    home: 'Главная',
    add: 'Добавить',
    event: 'Событие',
    search: 'Поиск',
    profile: 'Профиль',
  },
  auth: {
    tagline: 'Контакты, которые работают',
    devMode: 'Режим разработчика',
    loginAsDev: 'Войти как разработчик 🛠️',
    devLoginError: (msg: string) => 'Ошибка тестового входа: ' + msg,
    devName: 'Тестовый Разработчик',
    failedTitle: 'Не удалось войти',
    retry: 'Попробовать снова',
    authError: 'Ошибка авторизации',
    userFallback: 'Пользователь',
  },
  login: {
    info: 'Это приложение работает как Telegram Mini App. Откройте его через бота в Telegram для автоматической авторизации.',
  },
  home: {
    greetMorning: 'Доброе утро,',
    greetDay: 'Добрый день,',
    greetEvening: 'Добрый вечер,',
    greetNight: 'Доброй ночи,',
    holidays: 'Праздники',
    addBirthdays: 'Добавьте дни рождения контактам',
    favorites: 'Избранные',
    addFavorites: 'Добавьте контакты в избранное ⭐',
    today: '🎉',
    onboardTitle: 'Здесь будут ваши люди',
    onboardText: 'Добавьте первый контакт — расскажите о человеке текстом или голосом, остальное сделает AI.',
    onboardCta: 'Добавить первый контакт',
  },
  add: {
    title: 'Добавить контакт',
    titleFirstWord: 'Добавить ',
    placeholder: 'Напишите всё, что помните о контакте...',
    manualInput: 'Ручной ввод',
    firstName: 'Имя',
    lastName: 'Фамилия',
    phone: 'Телефон',
    company: 'Компания',
    email: 'Email',
    birthday: 'День рождения',
    done: 'Готово',
    tags: 'Теги',
    customTag: 'Свой тег...',
    submit: 'Добавить контакт',
    recording: '🎤 Запись... (до 20 сек)',
    micNoAccess: 'Нет доступа к микрофону',
    enterInfo: 'Введите информацию',
    enterInfoDesc: 'Напишите что-нибудь о контакте или заполните поля.',
    duplicateTitle: '⚠️ Контакт уже существует',
    duplicateDesc: (name: string, phone: string) => `${name} уже сохранён с номером ${phone}`,
    saved: 'Контакт сохранён!',
    savedDesc: (name: string) => `${name} добавлен.`,
    rateLimitErr: 'Слишком много запросов. Подождите минуту.',
    aiError: 'AI не смог обработать текст. Попробуйте переформулировать.',
    genericError: 'Не удалось сохранить контакт. Попробуйте ещё раз.',
    noName: 'Без имени',
    historyPrefix: (text: string) => `Первичная информация: ${text}`,
    tagPresets: ['РАБОТА', 'ДРУЗЬЯ', 'СЕМЬЯ', 'СПОРТ', 'БИЗНЕС', 'IT'],
  },
  search: {
    title: 'Поиск контакта',
    titleFirstWord: 'Поиск ',
    placeholder: 'Поиск...',
    smartSearch: 'Умный поиск',
    smartPlaceholder: 'Опишите, кого вы ищете...',
    find: 'Найти',
    aiResults: 'Результаты AI',
    allContacts: 'Все контакты',
    nobody: 'Никого не найдено',
    searchError: 'Ошибка поиска',
    contactWord: 'Контакт',
    noContactsYet: 'У вас пока нет контактов',
    addFirst: 'Добавить контакт',
  },
  profile: {
    total: 'Всего',
    active: 'Активных',
    topSphere: 'Топ сфера',
    networkGrowth: 'Рост нетворка',
    week: 'Нед',
    month: 'Мес',
    year: 'Год',
    lastPeriod: 'за последний период',
    contactsCount: (n: number | string) => `${n} контактов`,
    topTags: 'Топ теги',
    photoUpdated: 'Фото обновлено',
    connections: 'Связи',
    language: 'Язык',
  },
  favorites: {
    title: 'Избранные',
    empty: 'Список избранных пуст',
  },
  birthdays: {
    title: 'Праздники',
    empty: 'Список пуст',
  },
  contact: {
    notFound: 'Контакт не найден',
    removedFav: 'Удалено из избранного',
    addedFav: 'Добавлено в избранное',
    deleteConfirm: 'Удалить контакт? Все данные будут потеряны.',
    deleteConfirmShort: 'Удалить контакт?',
    deleted: 'Контакт удалён',
    noEvents: 'Нет событий',
    noEventsDesc: 'Добавьте хотя бы одно событие для генерации сводки.',
    dossierUpdated: 'Досье обновлено',
    rateLimitRetry: 'Подождите минуту и попробуйте снова.',
    summaryError: 'Не удалось сгенерировать сводку. Попробуйте позже.',
    contactUpdated: 'Контакт обновлён!',
    noChanges: 'Без изменений',
    updateError: 'Не удалось обновить контакт. Попробуйте позже.',
    photoUpdated: 'Фото обновлено',
    photoError: 'Ошибка загрузки',
    aiDossier: 'Досье',
    dossierEmpty: 'Пока мало данных о человеке — добавьте событие, и досье соберётся само.',
    askTitle: 'Вопрос по контакту',
    askPlaceholder: 'Спросите что-нибудь о человеке…',
    askShort: 'Вопрос',
    eventShort: 'Событие',
    analyzing: 'Анализ...',
    refresh: 'Обновить',
    recentEvents: 'Последние события',
    pressRefresh: 'Нажмите «Обновить» для анализа.',
    facts: 'Факты',
    factsNotFound: 'Факты не найдены',
    addEvent: 'Добавить событие',
    meetingHistory: 'История встреч',
    historyEmpty: 'История пока пуста',
    moreTags: (n: number) => `+${n} тегов`,
    showAllEvents: (n: number) => `Показать все ${n} событий`,
    whatChanged: 'Что изменилось?',
    applyChanges: 'Применить изменения',
    changeNote: (text: string) => `Изменение: ${text}`,
    editTitle: 'Редактировать',
    tabFields: 'Поля',
    tabAi: 'AI',
    fieldName: 'Имя',
    fieldRole: 'Должность / компания',
    fieldPhone: 'Телефон',
    fieldEmail: 'Email',
    fieldBirthday: 'День рождения',
    saveChanges: 'Сохранить',
    contactFallback: 'Контакт',
    eventLabels: { meeting: 'Встреча', call: 'Звонок', dinner: 'Ужин', note: 'Заметка' } as Record<string, string>,
    factLabels: { 'КОМПАНИЯ': 'КОМПАНИЯ', 'ДОЛЖНОСТЬ': 'ДОЛЖНОСТЬ', 'ОБРАЗОВАНИЕ': 'ОБРАЗОВАНИЕ', 'ВОЗРАСТ': 'ВОЗРАСТ' } as Record<string, string>,
  },
  event: {
    title: 'Добавить событие',
    titleFirstWord: 'Добавить ',
    participants: 'Участники',
    choosePeople: 'Выберите участников',
    add: 'Добавить',
    searchContact: 'Поиск контакта...',
    notFound: 'Не найдено',
    noContacts: 'Нет контактов',
    eventType: 'Тип события',
    customType: 'Свой тип...',
    chooseIcon: 'Выбрать иконку',
    notes: 'Заметки',
    submit: 'Добавить событие',
    errorContactNote: 'Укажите контакт и заметку.',
    eventAdded: 'Событие добавлено!',
    eventAddedDesc: 'AI обработал ваши заметки.',
    processError: 'Не удалось обработать событие.',
    defaultTypes: { meeting: 'Встреча', call: 'Звонок', dinner: 'Ужин' } as Record<string, string>,
  },
  settings: {
    title: 'Настройки',
    theme: 'Тема',
    themeSystem: 'Система',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    language: 'Язык',
    sound: 'Звук',
    soundVolume: 'Громкость',
    haptics: 'Вибрация',
    reminders: 'Напоминания',
    birthdayReminders: 'Дни рождения',
    staleReminders: 'Давно не общались',
    data: 'Данные',
    exportContacts: 'Экспорт контактов (.vcf)',
    exporting: 'Экспорт…',
    exportSent: 'Файл отправлен в чат с ботом',
    exportError: 'Не удалось экспортировать',
    exportEmpty: 'Нет контактов для экспорта',
    about: 'О приложении',
    version: 'Версия',
    openBot: 'Открыть бота',
  },
};

type Dict = typeof ru;

const en: Dict = {
  common: {
    loading: 'Loading...',
    error: 'Error',
    save: 'Save',
    add: 'Add',
    collapse: 'Collapse',
    rateLimit: 'Too many requests. Please wait a minute.',
  },
  nav: {
    home: 'Home',
    add: 'Add',
    event: 'Event',
    search: 'Search',
    profile: 'Profile',
  },
  auth: {
    tagline: 'Contacts that actually work',
    devMode: 'Developer mode',
    loginAsDev: 'Sign in as developer 🛠️',
    devLoginError: (msg: string) => 'Dev sign-in error: ' + msg,
    devName: 'Test Developer',
    failedTitle: 'Sign-in failed',
    retry: 'Try again',
    authError: 'Authentication error',
    userFallback: 'User',
  },
  login: {
    info: 'This app runs as a Telegram Mini App. Open it through the bot in Telegram for automatic sign-in.',
  },
  home: {
    greetMorning: 'Good morning,',
    greetDay: 'Good afternoon,',
    greetEvening: 'Good evening,',
    greetNight: 'Good night,',
    holidays: 'Birthdays',
    addBirthdays: 'Add birthdays to your contacts',
    favorites: 'Favorites',
    addFavorites: 'Add contacts to favorites ⭐',
    today: '🎉',
    onboardTitle: 'Your people will live here',
    onboardText: 'Add your first contact — describe the person by text or voice, AI does the rest.',
    onboardCta: 'Add your first contact',
  },
  add: {
    title: 'Add contact',
    titleFirstWord: 'Add ',
    placeholder: 'Write everything you remember about the contact...',
    manualInput: 'Manual input',
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone',
    company: 'Company',
    email: 'Email',
    birthday: 'Birthday',
    done: 'Done',
    tags: 'Tags',
    customTag: 'Custom tag...',
    submit: 'Add contact',
    recording: '🎤 Recording... (up to 20s)',
    micNoAccess: 'No microphone access',
    enterInfo: 'Enter some info',
    enterInfoDesc: 'Write something about the contact or fill in the fields.',
    duplicateTitle: '⚠️ Contact already exists',
    duplicateDesc: (name: string, phone: string) => `${name} is already saved with number ${phone}`,
    saved: 'Contact saved!',
    savedDesc: (name: string) => `${name} added.`,
    rateLimitErr: 'Too many requests. Please wait a minute.',
    aiError: 'AI could not process the text. Try rephrasing.',
    genericError: 'Could not save the contact. Please try again.',
    noName: 'No name',
    historyPrefix: (text: string) => `Initial info: ${text}`,
    tagPresets: ['WORK', 'FRIENDS', 'FAMILY', 'SPORT', 'BUSINESS', 'IT'],
  },
  search: {
    title: 'Search contact',
    titleFirstWord: 'Search ',
    placeholder: 'Search...',
    smartSearch: 'Smart search',
    smartPlaceholder: 'Describe who you are looking for...',
    find: 'Find',
    aiResults: 'AI results',
    allContacts: 'All contacts',
    nobody: 'Nobody found',
    searchError: 'Search error',
    contactWord: 'Contact',
    noContactsYet: 'You have no contacts yet',
    addFirst: 'Add contact',
  },
  profile: {
    total: 'Total',
    active: 'Active',
    topSphere: 'Top sphere',
    networkGrowth: 'Network growth',
    week: 'Wk',
    month: 'Mo',
    year: 'Yr',
    lastPeriod: 'over the last period',
    contactsCount: (n: number | string) => `${n} contacts`,
    topTags: 'Top tags',
    photoUpdated: 'Photo updated',
    connections: 'Connections',
    language: 'Language',
  },
  favorites: {
    title: 'Favorites',
    empty: 'No favorites yet',
  },
  birthdays: {
    title: 'Birthdays',
    empty: 'Nothing here yet',
  },
  contact: {
    notFound: 'Contact not found',
    removedFav: 'Removed from favorites',
    addedFav: 'Added to favorites',
    deleteConfirm: 'Delete contact? All data will be lost.',
    deleteConfirmShort: 'Delete contact?',
    deleted: 'Contact deleted',
    noEvents: 'No events',
    noEventsDesc: 'Add at least one event to generate a summary.',
    dossierUpdated: 'Dossier updated',
    rateLimitRetry: 'Wait a minute and try again.',
    summaryError: 'Could not generate the summary. Try later.',
    contactUpdated: 'Contact updated!',
    noChanges: 'No changes',
    updateError: 'Could not update the contact. Try later.',
    photoUpdated: 'Photo updated',
    photoError: 'Upload error',
    aiDossier: 'Dossier',
    dossierEmpty: 'Not much known yet — add an event and the dossier builds itself.',
    askTitle: 'Ask about contact',
    askPlaceholder: 'Ask anything about this person…',
    askShort: 'Ask',
    eventShort: 'Event',
    analyzing: 'Analyzing...',
    refresh: 'Refresh',
    recentEvents: 'Recent events',
    pressRefresh: 'Press “Refresh” for analysis.',
    facts: 'Facts',
    factsNotFound: 'No facts found',
    addEvent: 'Add event',
    meetingHistory: 'Meeting history',
    historyEmpty: 'No history yet',
    moreTags: (n: number) => `+${n} tags`,
    showAllEvents: (n: number) => `Show all ${n} events`,
    whatChanged: 'What changed?',
    applyChanges: 'Apply changes',
    changeNote: (text: string) => `Change: ${text}`,
    editTitle: 'Edit',
    tabFields: 'Fields',
    tabAi: 'AI',
    fieldName: 'Name',
    fieldRole: 'Role / company',
    fieldPhone: 'Phone',
    fieldEmail: 'Email',
    fieldBirthday: 'Birthday',
    saveChanges: 'Save',
    contactFallback: 'Contact',
    eventLabels: { meeting: 'Meeting', call: 'Call', dinner: 'Dinner', note: 'Note' } as Record<string, string>,
    factLabels: { 'КОМПАНИЯ': 'COMPANY', 'ДОЛЖНОСТЬ': 'ROLE', 'ОБРАЗОВАНИЕ': 'EDUCATION', 'ВОЗРАСТ': 'AGE' } as Record<string, string>,
  },
  event: {
    title: 'Add event',
    titleFirstWord: 'Add ',
    participants: 'Participants',
    choosePeople: 'Choose participants',
    add: 'Add',
    searchContact: 'Search contact...',
    notFound: 'Not found',
    noContacts: 'No contacts',
    eventType: 'Event type',
    customType: 'Custom type...',
    chooseIcon: 'Choose icon',
    notes: 'Notes',
    submit: 'Add event',
    errorContactNote: 'Select a contact and add a note.',
    eventAdded: 'Event added!',
    eventAddedDesc: 'AI processed your notes.',
    processError: 'Could not process the event.',
    defaultTypes: { meeting: 'Meeting', call: 'Call', dinner: 'Dinner' } as Record<string, string>,
  },
  settings: {
    title: 'Settings',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language',
    sound: 'Sound',
    soundVolume: 'Volume',
    haptics: 'Haptics',
    reminders: 'Reminders',
    birthdayReminders: 'Birthdays',
    staleReminders: 'Haven’t talked in a while',
    data: 'Data',
    exportContacts: 'Export contacts (.vcf)',
    exporting: 'Exporting…',
    exportSent: 'File sent to the bot chat',
    exportError: 'Export failed',
    exportEmpty: 'No contacts to export',
    about: 'About',
    version: 'Version',
    openBot: 'Open bot',
  },
};

const DICTS: Record<Lang, Dict> = { ru, en };

// ─────────────────────────── Provider / hooks ───────────────────────────

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: Dict;
}

const LangContext = createContext<LangContextValue>({
  lang: 'ru',
  setLang: () => {},
  toggleLang: () => {},
  t: ru,
});

function detectInitialLang(): Lang {
  // 1. Persisted manual choice wins.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
  } catch { /* localStorage unavailable */ }

  // 2. Telegram-provided language code.
  const code = getTelegramUser()?.language_code?.toLowerCase();
  if (code) return code.startsWith('ru') ? 'ru' : 'en';

  // 3. Browser language.
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  return 'ru';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Initialise with 'ru' so the first client render matches the server render
  // (avoids hydration mismatch); correct to the detected language on mount.
  const [lang, setLangState] = useState<Lang>('ru');

  useEffect(() => {
    const detected = detectInitialLang();
    setLangState(detected);
    try { document.documentElement.lang = detected; } catch { /* ignore */ }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    try { document.documentElement.lang = l; } catch { /* ignore */ }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'ru' ? 'en' : 'ru');
  }, [lang, setLang]);

  return (
    <LangContext.Provider value={{ lang, setLang, toggleLang, t: DICTS[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

/** Full language context (lang, setLang, toggleLang, t). */
export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/** Shortcut to the current dictionary. */
export function useT(): Dict {
  return useContext(LangContext).t;
}
