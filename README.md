# Mind Journey

MVP PWA для подготовки к system design поверх markdown/Obsidian базы знаний.

## Что уже есть

- Режим книги: чтение markdown-глав с содержанием.
- Режим повторения: карточки генерируются из markdown-заголовков, выделенных терминов и коротких блоков.
- Слои подготовки: `concept`, `decision`, `failure`, `scenario`.
- Design drills: сценарные тренировки с таймером, заметками и рубрикой самопроверки.
- Offline-first: service worker кеширует shell и API-ответ, прогресс хранится в `localStorage`.
- Go backend без внешних зависимостей.

## Запуск

```bash
npm install
npm run build
GOCACHE="$PWD/.gocache" go run ./cmd/server
```

Открыть: http://localhost:8080

## Подключение базы знаний

По умолчанию приложение стартует с небольшим встроенным seed-контентом. Чтобы читать реальную markdown-базу:

```bash
KNOWLEDGE_BASE_DIR="/path/to/go-backend-knowledge-base" GOCACHE="$PWD/.gocache" go run ./cmd/server
```

Backend рекурсивно читает `.md` файлы, извлекает заголовки, Obsidian wiki-links и генерирует учебные карточки.

## Dev-режим

В одном терминале:

```bash
GOCACHE="$PWD/.gocache" go run ./cmd/server
```

В другом:

```bash
npm run dev
```

Vite будет доступен на http://localhost:5173 и проксировать `/api` в Go backend.

