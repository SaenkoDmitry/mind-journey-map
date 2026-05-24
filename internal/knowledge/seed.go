package knowledge

import "time"

const seedMarkdown = `# System Design

> Интервью по system design проверяет не только факты, а способность вести дизайн-разговор: requirements, NFR, API, data model, read/write paths, bottlenecks, failure modes и observability.

## Формализация требований

Перед проектированием нужно уточнить функциональные требования и NFR. Для банковской системы consistency может быть важнее latency, а для социальной ленты часто допустима eventual consistency.

## Read path и write path

Read path описывает, как данные читаются: cache, replicas, indexes. Write path описывает запись: транзакции, очереди, WAL, retries, idempotency.

## Failure modes

Для каждого компонента нужно уметь объяснить, что случится при отказе, какой blast radius, как система восстановится и какие метрики покажут проблему.
`

const cacheMarkdown = `# Кэширование

> Цель кэширования - снизить latency системы и нагрузку на компоненты.

## Cache-Aside

**READ PATH**: приложение читает из cache, при miss идет в DB и обновляет cache. **WRITE PATH**: запись сначала в DB, затем invalidate или update cache. Риск - stale data, если забыть invalidation.

## Thundering herd problem

Ситуация, когда у горячего ключа истекает TTL и много запросов одновременно идут в DB. Решения: singleflight, jitter, refresh-ahead, distributed lock.

## Multi-level cache

L1 local cache, L2 Redis, L3 DB. Каждый дополнительный уровень ускоряет чтение, но увеличивает риск stale data amplification. Нужны короткие TTL, versioned keys или event-driven invalidation.
`

func Seed() *Store {
	topics := []Topic{
		parseTopic("System Design.md", seedMarkdown),
		parseTopic("Кэширование.md", cacheMarkdown),
	}
	return &Store{library: Library{
		Source:    "bundled-seed",
		UpdatedAt: time.Now().UTC(),
		Topics:    topics,
		Cards:     buildCards(topics),
		Drills:    buildDrills(topics),
	}}
}
