package knowledge

import "time"

type Library struct {
	Source    string    `json:"source"`
	UpdatedAt time.Time `json:"updatedAt"`
	Topics    []Topic   `json:"topics"`
	Cards     []Card    `json:"cards"`
	Drills    []Drill   `json:"drills"`
}

type Topic struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Path     string    `json:"path"`
	Summary  string    `json:"summary"`
	Content  string    `json:"content"`
	Sections []Section `json:"sections"`
	Links    []string  `json:"links"`
}

type Section struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Level   int    `json:"level"`
	Content string `json:"content"`
}

type Card struct {
	ID           string   `json:"id"`
	TopicID      string   `json:"topicId"`
	Topic        string   `json:"topic"`
	Section      string   `json:"section"`
	HeadingLevel int      `json:"headingLevel"`
	Layer        string   `json:"layer"`
	Prompt       string   `json:"prompt"`
	Answer       string   `json:"answer"`
	Tags         []string `json:"tags"`
	Priority     int      `json:"priority"`
}

type Drill struct {
	ID       string   `json:"id"`
	TopicID  string   `json:"topicId"`
	Title    string   `json:"title"`
	Prompt   string   `json:"prompt"`
	Rubric   []string `json:"rubric"`
	Duration int      `json:"duration"`
}
