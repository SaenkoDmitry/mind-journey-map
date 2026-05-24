package knowledge

import (
	"fmt"
	"sort"
	"strings"
)

func buildCards(topics []Topic) []Card {
	var cards []Card
	for _, topic := range topics {
		topicCards := buildTopicCards(topic, false)
		if len(topicCards) == 0 {
			topicCards = buildTopicCards(topic, true)
		}
		cards = append(cards, topicCards...)
	}

	sort.Slice(cards, func(i, j int) bool {
		if cards[i].Topic == cards[j].Topic {
			if cards[i].Section == cards[j].Section {
				return cards[i].Prompt < cards[j].Prompt
			}
			return cards[i].Section < cards[j].Section
		}
		return cards[i].Topic < cards[j].Topic
	})
	return dedupeCards(cards)
}

func buildTopicCards(topic Topic, allowLevelTwo bool) []Card {
	var cards []Card
	mainSection := topic.Title

	for _, section := range topic.Sections {
		if section.Level == 2 {
			mainSection = section.Title
		}
		if !isCardHeading(section.Level, allowLevelTwo) || len(strings.TrimSpace(section.Content)) < 32 {
			continue
		}

		layer := classifyLayer(section.Title, section.Content)
		answer := strings.TrimSpace(section.Content)
		if answer == "" {
			continue
		}

		cards = append(cards, Card{
			ID:           stableID(topic.ID + section.ID + mainSection),
			TopicID:      topic.ID,
			Topic:        topic.Title,
			Section:      mainSection,
			HeadingLevel: section.Level,
			Layer:        layer,
			Prompt:       promptFor(layer, section.Title),
			Answer:       answer,
			Tags:         tagsFor(topic.Title, mainSection, section.Title, section.Content),
			Priority:     priorityFor(layer, section.Content),
		})
	}

	return cards
}

func isCardHeading(level int, allowLevelTwo bool) bool {
	if allowLevelTwo {
		return level == 2
	}
	return level == 3 || level == 4
}

func legacyBuildCards(topics []Topic) []Card {
	var cards []Card
	for _, topic := range topics {
		for _, section := range topic.Sections {
			if section.Level > 4 || len(strings.TrimSpace(section.Content)) < 40 {
				continue
			}

			layer := classifyLayer(section.Title, section.Content)
			answer := compactAnswer(section.Content)
			if answer == "" {
				continue
			}

			cards = append(cards, Card{
				ID:           stableID(topic.ID + section.ID + layer),
				TopicID:      topic.ID,
				Topic:        topic.Title,
				Section:      topic.Title,
				HeadingLevel: section.Level,
				Layer:        layer,
				Prompt:       promptFor(layer, section.Title),
				Answer:       answer,
				Tags:         tagsFor(topic.Title, section.Title, section.Content),
				Priority:     priorityFor(layer, section.Content),
			})
		}
	}

	sort.Slice(cards, func(i, j int) bool {
		if cards[i].Priority == cards[j].Priority {
			return cards[i].Prompt < cards[j].Prompt
		}
		return cards[i].Priority > cards[j].Priority
	})
	return dedupeCards(cards)
}

func buildDrills(topics []Topic) []Drill {
	var drills []Drill
	for _, topic := range topics {
		content := strings.ToLower(topic.Content)
		if !strings.Contains(content, "system design") &&
			!strings.Contains(content, "масштаб") &&
			!strings.Contains(content, "кэш") &&
			!strings.Contains(content, "очеред") &&
			!strings.Contains(content, "баз") {
			continue
		}

		drills = append(drills, Drill{
			ID:       stableID("drill" + topic.ID),
			TopicID:  topic.ID,
			Title:    "Design drill: " + topic.Title,
			Prompt:   fmt.Sprintf("Представь, что на интервью тебя попросили спроектировать систему, где ключевая тема - %s. Зафиксируй requirements, NFR, API, read/write paths, storage choices, scaling strategy и failure modes.", topic.Title),
			Rubric:   rubricForTopic(topic),
			Duration: 25,
		})
	}
	if len(drills) == 0 {
		drills = Seed().library.Drills
	}
	return drills
}

func rubricForTopic(topic Topic) []string {
	base := []string{
		"Сформулированы функциональные и нефункциональные требования",
		"Есть понятные API и границы системы",
		"Разделены read path и write path",
	}
	text := strings.ToLower(topic.Title + " " + topic.Content)

	switch {
	case strings.Contains(text, "кэш") || strings.Contains(text, "cache"):
		return append(base,
			"Выбрана стратегия кэширования и объяснена invalidation",
			"Разобраны stale reads, hot keys, stampede и observability cache layer",
		)
	case strings.Contains(text, "очеред") || strings.Contains(text, "kafka") || strings.Contains(text, "event"):
		return append(base,
			"Описаны producers, consumers, partitioning и ordering guarantees",
			"Разобраны retries, idempotency, DLQ, lag и delivery semantics",
		)
	case strings.Contains(text, "баз") || strings.Contains(text, "db") || strings.Contains(text, "postgres"):
		return append(base,
			"Выбор хранилища объяснен через consistency, indexes и query patterns",
			"Разобраны replication, sharding, transactions и recovery",
		)
	case strings.Contains(text, "observability") || strings.Contains(text, "инфраструктур"):
		return append(base,
			"Названы SLI/SLO, метрики, логи, трейсы и алерты",
			"Понятен rollout, rollback и degradation strategy",
		)
	default:
		return append(base,
			"Выбор компонентов объяснен через trade-offs",
			"Названы bottlenecks, failure modes и метрики observability",
		)
	}
}

func classifyLayer(title string, content string) string {
	text := strings.ToLower(title + " " + content)
	switch {
	case strings.Contains(text, "problem") || strings.Contains(text, "проблем") || strings.Contains(text, "риск") || strings.Contains(text, "failure") || strings.Contains(text, "отказ"):
		return "failure"
	case strings.Contains(text, "когда") || strings.Contains(text, "vs") || strings.Contains(text, "trade") || strings.Contains(text, "выбор") || strings.Contains(text, "плюсы"):
		return "decision"
	case strings.Contains(text, "read path") || strings.Contains(text, "write path") || strings.Contains(text, "flow") || strings.Contains(text, "путь"):
		return "scenario"
	default:
		return "concept"
	}
}

func promptFor(layer string, title string) string {
	return title
}

func compactAnswer(content string) string {
	var lines []string
	inCodeBlock := false
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "```") {
			inCodeBlock = !inCodeBlock
			continue
		}
		if inCodeBlock {
			continue
		}
		if line == "" || strings.HasPrefix(line, "---") {
			continue
		}
		line = strings.TrimLeft(line, ">- \t")
		lines = append(lines, line)
		if len(strings.Join(lines, " ")) > 520 {
			break
		}
	}
	return limit(strings.Join(lines, "\n"), 720)
}

func tagsFor(values ...string) []string {
	seen := map[string]bool{}
	var tags []string
	for _, value := range values {
		text := strings.ToLower(value)
		for _, tag := range []string{"cache", "кэш", "db", "бд", "kafka", "очеред", "api", "nfr", "consistency", "latency", "scaling", "масштаб"} {
			if strings.Contains(text, tag) && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	if len(tags) == 0 {
		tags = append(tags, "core")
	}
	return tags
}

func priorityFor(layer string, content string) int {
	score := 1
	if layer == "decision" || layer == "failure" || layer == "scenario" {
		score++
	}
	text := strings.ToLower(content)
	if strings.Contains(text, "важно") || strings.Contains(text, "риск") || strings.Contains(text, "trade") || strings.Contains(text, "interview") {
		score++
	}
	return score
}

func dedupeCards(cards []Card) []Card {
	seen := map[string]bool{}
	var result []Card
	for _, card := range cards {
		key := strings.ToLower(card.TopicID + card.Prompt)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, card)
	}
	return result
}
