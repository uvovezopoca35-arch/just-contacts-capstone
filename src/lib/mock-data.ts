import { Contact, InteractionEvent } from "./types";
import { PlaceHolderImages } from "./placeholder-images";

const now = new Date();
const month = (m: number) => new Date(now.getFullYear(), now.getMonth() - m, 15).toISOString();

// Вспомогательная функция для создания дат рождения
const createBirthday = (monthOffset: number, day: number) => {
  const date = new Date();
  date.setMonth(date.getMonth() + monthOffset);
  date.setDate(day);
  return date.toISOString();
};

export const MOCK_CONTACTS: Contact[] = [
  {
    id: "1",
    userId: "user-1",
    name: "Борис Г.",
    role: "CEO",
    tags: ["ВАЖНО", "CEO", "ИНВЕСТИЦИИ"],
    summary: "Ключевой партнер по инвестициям. Обсуждали стратегию развития на 2024 год.",
    lastInteraction: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: month(2),
    interactionScore: 95,
    birthday: createBirthday(0, 12), // ДР через несколько дней или в этом месяце
    telegram: "@boris_g", 
    phone: "+7 900 111 22 33",
    avatarUrl: PlaceHolderImages[0].imageUrl
  },
  {
    id: "2",
    userId: "user-1",
    name: "Анна Дизайн",
    role: "Фриланс",
    tags: ["ФРИЛАНС", "ДИЗАЙН"],
    summary: "Отличный дизайнер интерфейсов. Делала нам лендинг для проекта X.",
    lastInteraction: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: month(1),
    interactionScore: 40,
    birthday: createBirthday(1, 5),
    telegram: "@anna_design",
    avatarUrl: PlaceHolderImages[1].imageUrl
  },
  {
    id: "3",
    userId: "user-1",
    name: "Максим П.",
    role: "Разработчик",
    tags: ["ПИТЕР", "IT"],
    summary: "Живет в Питере. Знает всё про микросервисы. Помогал с бэкендом.",
    lastInteraction: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: month(5),
    interactionScore: 60,
    birthday: createBirthday(0, 25),
    phone: "+7 922 333 44 55",
    avatarUrl: PlaceHolderImages[2].imageUrl
  },
  {
    id: "4",
    userId: "user-1",
    name: "Елена К.",
    role: "Партнер",
    tags: ["ПАРТНЕР", "МАРКЕТИНГ"],
    summary: "Встречались на конференции. Обсуждали возможности коллаборации.",
    lastInteraction: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: month(8),
    interactionScore: 70,
    birthday: createBirthday(2, 10),
    telegram: "@elena_k",
    avatarUrl: "https://picsum.photos/seed/4/400/400"
  },
  {
    id: "5",
    userId: "user-1",
    name: "Александр Волков",
    role: "Crypto Investor",
    tags: ["ИНВЕСТОРЫ", "КРИПТО"],
    summary: "Крипто-эксперт. Обсуждали перспективы биткоина и эфира.",
    lastInteraction: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: month(12),
    interactionScore: 30,
    birthday: createBirthday(-1, 20), // Был недавно
    telegram: "@avolkov",
    avatarUrl: "https://picsum.photos/seed/5/400/400"
  },
  ...Array.from({ length: 20 }).map((_, i) => ({
    id: `test-${i}`,
    userId: "user-1",
    name: `Контакт ${i + 6}`,
    role: i % 2 === 0 ? "Разработчик" : "Менеджер",
    tags: i % 3 === 0 ? ["IT", "WEB3"] : i % 3 === 1 ? ["DESIGN", "UX"] : ["BUSINESS", "SALES"],
    summary: "Тестовый контакт для проверки графиков и статистики.",
    lastInteraction: month(i % 12),
    createdAt: month(i * 2),
    interactionScore: Math.floor(Math.random() * 100),
    birthday: createBirthday(i % 6, (i * 7) % 28 + 1),
    telegram: `@user_${i}`,
    avatarUrl: `https://picsum.photos/seed/${i + 10}/400/400`
  }))
];

export const MOCK_INTERACTIONS: Record<string, InteractionEvent[]> = {
  "1": [{ id: "h1", contactId: "1", date: "2024-03-20T10:00:00Z", type: "meeting", summary: "Переговоры по инвестициям." }]
};
