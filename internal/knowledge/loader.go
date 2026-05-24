package knowledge

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var wikiLinkPattern = regexp.MustCompile(`\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]`)

type Store struct {
	library Library
}

func Load(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return Seed(), nil
	}

	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("content path is not a directory")
	}

	var topics []Topic
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(path), ".md") {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		topics = append(topics, parseTopic(rel, string(content)))
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(topics) == 0 {
		return nil, errors.New("no markdown files found")
	}

	sort.Slice(topics, func(i, j int) bool {
		if topics[i].Path == "README.md" {
			return true
		}
		if topics[j].Path == "README.md" {
			return false
		}
		return topics[i].Title < topics[j].Title
	})

	library := Library{
		Source:    root,
		UpdatedAt: time.Now().UTC(),
		Topics:    topics,
	}
	library.Cards = buildCards(topics)
	library.Drills = buildDrills(topics)

	return &Store{library: library}, nil
}

func (s *Store) Library() Library {
	return s.library
}

func parseTopic(path string, markdown string) Topic {
	title := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	sections := parseSections(markdown)
	if len(sections) > 0 && sections[0].Level == 1 {
		title = sections[0].Title
	}

	return Topic{
		ID:       stableID(path),
		Title:    title,
		Path:     path,
		Summary:  summarize(markdown),
		Content:  markdown,
		Sections: sections,
		Links:    extractLinks(markdown),
	}
}

func parseSections(markdown string) []Section {
	lines := strings.Split(markdown, "\n")
	var sections []Section
	var current *Section
	var body []string
	headingCounts := map[string]int{}

	flush := func() {
		if current == nil {
			return
		}
		current.Content = strings.TrimSpace(strings.Join(body, "\n"))
		sections = append(sections, *current)
		body = nil
	}

	for _, line := range lines {
		level, title, ok := heading(line)
		if ok {
			flush()
			baseID := stableID(title)
			headingCounts[baseID]++
			id := baseID
			if headingCounts[baseID] > 1 {
				id = baseID + "-" + stableID(title+strconv.Itoa(headingCounts[baseID]))
			}
			current = &Section{
				ID:    id,
				Title: title,
				Level: level,
			}
			continue
		}
		if current != nil {
			body = append(body, line)
		}
	}
	flush()
	return sections
}

func heading(line string) (int, string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "#") {
		return 0, "", false
	}
	level := 0
	for level < len(trimmed) && trimmed[level] == '#' {
		level++
	}
	if level == 0 || level > 6 || level >= len(trimmed) || trimmed[level] != ' ' {
		return 0, "", false
	}
	title := strings.Trim(strings.TrimSpace(trimmed[level:]), "*")
	if title == "" {
		return 0, "", false
	}
	return level, title, true
}

func summarize(markdown string) string {
	for _, raw := range strings.Split(markdown, "\n") {
		line := strings.TrimSpace(strings.TrimLeft(raw, ">- \t"))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[[") || strings.HasPrefix(line, "---") {
			continue
		}
		return limit(line, 220)
	}
	return "Пока без краткого описания."
}

func extractLinks(markdown string) []string {
	matches := wikiLinkPattern.FindAllStringSubmatch(markdown, -1)
	seen := map[string]bool{}
	var links []string
	for _, match := range matches {
		link := strings.TrimSpace(match[1])
		if link != "" && !seen[link] {
			seen[link] = true
			links = append(links, link)
		}
	}
	sort.Strings(links)
	return links
}

func stableID(value string) string {
	sum := sha1.Sum([]byte(strings.ToLower(strings.TrimSpace(value))))
	return hex.EncodeToString(sum[:])[:12]
}

func limit(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max-1]) + "…"
}
