import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Library = {
  source: string;
  updatedAt: string;
  topics: Topic[];
  cards: Card[];
};

type Topic = {
  id: string;
  title: string;
  path: string;
  summary: string;
  content: string;
  sections: Section[];
  links: string[];
};

type Section = {
  id: string;
  title: string;
  level: number;
  content: string;
};

type Card = {
  id: string;
  topicId: string;
  topic: string;
  section: string;
  headingLevel: number;
  layer: "concept" | "decision" | "failure" | "scenario";
  prompt: string;
  answer: string;
  tags: string[];
  priority: number;
};

type ReviewState = Record<string, { ease: number; due: string; count: number; lastReviewed: string }>;
type Mode = "book" | "review";

const reviewLabels = [
  { label: "Снова", hint: "сегодня", ease: 0, days: 0 },
  { label: "Трудно", hint: "завтра", ease: 1, days: 1 },
  { label: "Нормально", hint: "через 3 дня", ease: 2, days: 3 },
  { label: "Легко", hint: "через неделю", ease: 3, days: 7 }
];

function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [mode, setMode] = useState<Mode>("book");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState("mind-journey-sidebar-collapsed", false);
  const isMobileLayout = useMediaQuery("(max-width: 920px)");
  const [reviewState, setReviewState] = usePersistentState<ReviewState>("mind-journey-review", {});
  const [activeCardId, setActiveCardId] = useState("");
  const [answerVisible, setAnswerVisible] = useState(false);

  useEffect(() => {
    fetch("/api/library")
      .then((response) => {
        if (!response.ok) throw new Error("Library request failed");
        return response.json() as Promise<Library>;
      })
      .then((data) => {
        setLibrary(data);
        setSelectedTopicId((current) => current || data.topics[0]?.id || "");
        localStorage.setItem("mind-journey-library", JSON.stringify(data));
      })
      .catch(() => {
        const cached = localStorage.getItem("mind-journey-library");
        if (cached) {
          const data = JSON.parse(cached) as Library;
          setLibrary(data);
          setSelectedTopicId(data.topics[0]?.id || "");
        }
      });
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const topicLookup = useMemo(() => buildTopicLookup(library?.topics || []), [library]);
  const selectedTopic = library?.topics.find((topic) => topic.id === selectedTopicId) || library?.topics[0];

  const reviewCards = useMemo(() => {
    if (!library) return [];
    return library.cards
      .filter((card) => selectedTopicId === "all" || card.topicId === selectedTopicId)
      .sort((a, b) => {
        const aDue = reviewState[a.id]?.due || "1970-01-01";
        const bDue = reviewState[b.id]?.due || "1970-01-01";
        if (aDue === bDue) return b.priority - a.priority;
        return aDue.localeCompare(bDue);
      });
  }, [library, reviewState, selectedTopicId]);

  const activeCard = reviewCards.find((card) => card.id === activeCardId) || reviewCards[0];

  useEffect(() => {
    setActiveCardId("");
    setAnswerVisible(false);
  }, [selectedTopicId]);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    if (nextMode === "book" && selectedTopicId === "all") {
      setSelectedTopicId(library?.topics[0]?.id || "");
    }
  }

  function changeTopic(topicID: string) {
    setSelectedTopicId(topicID);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTopicByTitle(title: string) {
    const topic = topicLookup.get(normalizeTitle(title));
    if (!topic) return;
    setMode("book");
    changeTopic(topic.id);
  }

  function gradeCard(card: Card, ease: number, days: number) {
    const now = new Date();
    const due = new Date(now);
    due.setDate(due.getDate() + days);
    setReviewState((state) => ({
      ...state,
      [card.id]: {
        ease,
        due: due.toISOString(),
        count: (state[card.id]?.count || 0) + 1,
        lastReviewed: now.toISOString()
      }
    }));

    const nextCard = reviewCards.find((item) => item.id !== card.id && isDue(item, reviewState));
    setAnswerVisible(false);
    setActiveCardId(nextCard?.id || "");
  }

  if (!library) {
    return <LoadingScreen />;
  }

  const completed = Object.keys(reviewState).length;
  const effectiveSidebarCollapsed = sidebarCollapsed && !isMobileLayout;

  return (
    <main className={`app-shell ${effectiveSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"}
          title={sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>

        <div className="sidebar-content">
          <div className="brand">
            <span className="brand-mark">MJ</span>
            <div>
              <h1>Mind Journey</h1>
              <p title={library.source}>{compactSource(library.source)}</p>
            </div>
          </div>

          <nav className="mode-tabs" aria-label="Режимы">
            <button className={mode === "book" ? "active" : ""} onClick={() => changeMode("book")}>
              Книга
            </button>
            <button className={mode === "review" ? "active" : ""} onClick={() => changeMode("review")}>
              Повторение
            </button>
          </nav>

          <TopicList
            topics={library.topics}
            selectedTopicId={selectedTopicId}
            showAll={mode === "review"}
            onSelect={changeTopic}
          />

          <div className="stats">
            <Metric label="Глав" value={library.topics.length} />
            <Metric label="Карточек" value={library.cards.length} />
            <Metric label="Начато" value={completed} />
          </div>
        </div>

        <div className="sidebar-rail">
          <span className="brand-mark">MJ</span>
          <nav aria-label="Свернутая навигация">
            <button className={mode === "book" ? "active" : ""} onClick={() => changeMode("book")} title="Книга">
              К
            </button>
            <button className={mode === "review" ? "active" : ""} onClick={() => changeMode("review")} title="Повторение">
              П
            </button>
          </nav>
        </div>
      </aside>

      <section className="workspace">
        {mode === "book" && selectedTopic && <BookView topic={selectedTopic} onOpenTopic={openTopicByTitle} />}
        {mode === "review" && (
          <ReviewView
            card={activeCard}
            cards={reviewCards}
            title={selectedTopicId === "all" ? "Все главы" : selectedTopic?.title || "Повторение"}
            state={reviewState}
            visible={answerVisible}
            onReveal={() => setAnswerVisible(true)}
            onPick={(cardID) => {
              setActiveCardId(cardID);
              setAnswerVisible(false);
            }}
            onGrade={(ease, days) => activeCard && gradeCard(activeCard, ease, days)}
          />
        )}
      </section>
    </main>
  );
}

function TopicList({
  topics,
  selectedTopicId,
  showAll,
  onSelect
}: {
  topics: Topic[];
  selectedTopicId: string;
  showAll: boolean;
  onSelect: (topicID: string) => void;
}) {
  return (
    <section className="topic-picker" aria-label="Главы">
      <h2>Главы</h2>
      <div className="topic-list">
        {showAll && (
          <button className={selectedTopicId === "all" ? "active" : ""} onClick={() => onSelect("all")}>
            Все главы
          </button>
        )}
        {topics.map((topic) => (
          <button key={topic.id} className={selectedTopicId === topic.id ? "active" : ""} onClick={() => onSelect(topic.id)}>
            {topic.title}
          </button>
        ))}
      </div>
    </section>
  );
}

function BookView({ topic, onOpenTopic }: { topic: Topic; onOpenTopic: (title: string) => void }) {
  function handleMarkdownClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const wikiLink = target.closest<HTMLElement>("[data-topic-title]");
    if (!wikiLink) return;
    onOpenTopic(wikiLink.dataset.topicTitle || "");
  }

  return (
    <article className="book-view" onClick={handleMarkdownClick}>
      <header className="page-header">
        <p>{topic.path}</p>
        <h2>{topic.title}</h2>
        <span>{topic.summary}</span>
      </header>

      <div className={`book-layout ${topic.sections.length <= 1 ? "single-section" : ""}`}>
        {topic.sections.length > 1 ? (
          <nav className="toc" aria-label="Содержание главы">
            {topic.sections.map((section) => (
              <a key={`${topic.id}-${section.id}`} href={`#${section.id}`} style={{ paddingLeft: `${Math.max(section.level - 1, 0) * 10}px` }}>
                {section.title}
              </a>
            ))}
          </nav>
        ) : (
          <></>
        )}

        <div className="markdown-body">
          {topic.sections.length === 0 ? (
            <MarkdownBlock markdown={topic.content} />
          ) : (
            topic.sections.map((section, index) => {
              const duplicatePageTitle = index === 0 && normalizeTitle(section.title) === normalizeTitle(topic.title);
              return (
                <section key={`${topic.id}-${section.id}`} id={section.id} className={duplicatePageTitle ? "section-without-title" : ""}>
                  {!duplicatePageTitle && React.createElement(`h${Math.min(section.level + 1, 4)}`, null, section.title)}
                  <MarkdownBlock markdown={section.content} />
                </section>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
}

function ReviewView({
  card,
  cards,
  title,
  state,
  visible,
  onReveal,
  onPick,
  onGrade
}: {
  card?: Card;
  cards: Card[];
  title: string;
  state: ReviewState;
  visible: boolean;
  onReveal: () => void;
  onPick: (cardID: string) => void;
  onGrade: (ease: number, days: number) => void;
}) {
  const stats = reviewStats(cards, state);

  if (!card) {
    return (
      <section className="empty-state">
        <h2>Карточек пока нет</h2>
        <p>Для карточек нужны markdown-разделы `###` или `####`. Если их нет, приложение возьмет `##` как fallback.</p>
      </section>
    );
  }

  return (
    <section className="review-view">
      <header className="page-header compact">
        <p>Повторение · {cards.length} карточек</p>
        <h2>{title}</h2>
        <span>{stats.remaining === 0 ? "Тема закрыта: все карточки закреплены." : `Осталось закрепить: ${stats.remaining} из ${stats.total}.`}</span>
      </header>

      <div className="review-dashboard">
        <Metric label="Всего" value={stats.total} />
        <Metric label="Новые" value={stats.newCards} />
        <Metric label="К повторению" value={stats.due} />
        <Metric label="Начато" value={stats.started} />
        <Metric label="Закреплено" value={stats.learned} />
      </div>

      <div className="progress-panel">
        <div className="progress-summary">
          <div>
            <strong>{stats.percent}%</strong>
            <span>прогресс темы</span>
          </div>
          <div className="progress-track" aria-label={`Прогресс ${stats.percent}%`}>
            <span style={{ width: `${stats.percent}%` }} />
          </div>
        </div>
        <div className="progress-sections">
          {sectionStats(cards, state).map((section) => (
            <div key={section.name}>
              <span>{section.name}</span>
              <strong>
                {section.learned}/{section.total}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="study-layout">
        <aside className="card-browser" aria-label="Список карточек">
          {cards.map((item) => (
            <button key={item.id} className={item.id === card.id ? "active" : ""} onClick={() => onPick(item.id)}>
              <span>{item.prompt}</span>
              <small>
                {item.section} · {cardStatus(item, state)}
              </small>
            </button>
          ))}
        </aside>

        <div className="flashcard">
          <div className="card-meta">
            <span>{card.topic}</span>
            <span>{card.section}</span>
          </div>

          <h3>{card.prompt}</h3>

          {!visible ? (
            <button className="reveal-button" onClick={onReveal}>
              Показать ответ
            </button>
          ) : (
            <>
              <MarkdownBlock markdown={card.answer} />
              <p className="grade-hint">Оценка задает дату следующего повторения.</p>
              <div className="grade-row">
                {reviewLabels.map((grade) => (
                  <button key={grade.label} onClick={() => onGrade(grade.ease, grade.days)}>
                    <strong>{grade.label}</strong>
                    <span>{grade.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function MarkdownBlock({ markdown }: { markdown: string }) {
  return <>{parseMarkdown(markdown).map(renderMarkdownNode)}</>;
}

type MarkdownNode =
  | { type: "paragraph"; lines: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: { text: string; checked?: boolean }[] }
  | { type: "code"; language: string; code: string }
  | { type: "hr" };

function parseMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: MarkdownNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) {
      index++;
      continue;
    }

    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      const language = fence[1] || "";
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      index++;
      nodes.push({ type: "code", language, code: code.join("\n") });
      continue;
    }

    if (/^---+$/.test(line)) {
      nodes.push({ type: "hr" });
      index++;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index++;
      }
      nodes.push({ type: "blockquote", lines: quote });
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: { text: string; checked?: boolean }[] = [];
      while (index < lines.length && isListLine(lines[index].trim())) {
        const parsed = parseListLine(lines[index].trim());
        items.push(parsed);
        index++;
      }
      nodes.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || next.startsWith(">") || next.startsWith("```") || /^---+$/.test(next) || isListLine(next)) break;
      paragraph.push(lines[index].trim());
      index++;
    }
    nodes.push({ type: "paragraph", lines: paragraph });
  }

  return nodes;
}

function renderMarkdownNode(node: MarkdownNode, index: number) {
  if (node.type === "hr") return <hr key={index} />;
  if (node.type === "code") {
    return (
      <pre key={index}>
        {node.language && <span className="code-lang">{node.language}</span>}
        <code>{node.code}</code>
      </pre>
    );
  }
  if (node.type === "blockquote") {
    return <blockquote key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(node.lines.join("\n")).replace(/\n/g, "<br />") }} />;
  }
  if (node.type === "list") {
    const Tag = node.ordered ? "ol" : "ul";
    return (
      <Tag key={index}>
        {node.items.map((item, itemIndex) => (
          <li key={`${item.text}-${itemIndex}`} className={item.checked !== undefined ? "task-item" : ""}>
            {item.checked !== undefined && <input type="checkbox" checked={item.checked} readOnly />}
            <span dangerouslySetInnerHTML={{ __html: inlineMarkdown(item.text) }} />
          </li>
        ))}
      </Tag>
    );
  }
  return <p key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(node.lines.join("\n")).replace(/\n/g, "<br />") }} />;
}

function isListLine(value: string) {
  return /^[-*]\s+/.test(value) || /^\d+\.\s+/.test(value);
}

function parseListLine(value: string) {
  const cleaned = value.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
  const task = cleaned.match(/^\[([ xX])\]\s+(.*)$/);
  if (task) {
    return { text: task[2], checked: task[1].toLowerCase() === "x" };
  }
  return { text: cleaned };
}

function inlineMarkdown(value: string) {
  return escapeHTML(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, title, label) => {
      const display = label || title;
      return `<button class="wiki-link" data-topic-title="${escapeAttribute(title)}" type="button">${display}</button>`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
}

function reviewStats(cards: Card[], state: ReviewState) {
  const now = Date.now();
  const base = cards.reduce(
    (stats, card) => {
      const item = state[card.id];
      if (!item) {
        stats.newCards++;
        stats.due++;
        return stats;
      }
      const due = new Date(item.due).getTime();
      stats.started++;
      if (due <= now) stats.due++;
      if (item.ease >= 2 && due > now) stats.learned++;
      return stats;
    },
    { total: cards.length, due: 0, newCards: 0, started: 0, learned: 0, remaining: 0, percent: 0 }
  );
  base.remaining = Math.max(0, base.total - base.learned);
  base.percent = base.total === 0 ? 0 : Math.round((base.learned / base.total) * 100);
  return base;
}

function sectionStats(cards: Card[], state: ReviewState) {
  const now = Date.now();
  const bySection = new Map<string, { name: string; total: number; learned: number }>();
  for (const card of cards) {
    const current = bySection.get(card.section) || { name: card.section, total: 0, learned: 0 };
    const item = state[card.id];
    current.total++;
    if (item && item.ease >= 2 && new Date(item.due).getTime() > now) {
      current.learned++;
    }
    bySection.set(card.section, current);
  }
  return [...bySection.values()].sort((a, b) => {
    const aDone = a.total === 0 ? 0 : a.learned / a.total;
    const bDone = b.total === 0 ? 0 : b.learned / b.total;
    if (aDone === bDone) return a.name.localeCompare(b.name);
    return aDone - bDone;
  });
}

function cardStatus(card: Card, state: ReviewState) {
  const item = state[card.id];
  if (!item) return "новая";
  if (new Date(item.due).getTime() <= Date.now()) return "пора повторить";
  return `${item.count} повтор.`;
}

function isDue(card: Card, state: ReviewState) {
  const item = state[card.id];
  return !item || new Date(item.due).getTime() <= Date.now();
}

function escapeHTML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHTML(value).replace(/'/g, "&#39;");
}

function buildTopicLookup(topics: Topic[]) {
  const lookup = new Map<string, Topic>();
  for (const topic of topics) {
    lookup.set(normalizeTitle(topic.title), topic);
    lookup.set(normalizeTitle(topic.path.replace(/\.md$/i, "")), topic);
  }
  return lookup;
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compactSource(source: string) {
  if (source === "bundled-seed") return source;
  const parts = source.split("/");
  if (parts.length <= 3) return source;
  return `.../${parts.slice(-3).join("/")}`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">MJ</div>
      <p>Загружаю базу знаний...</p>
    </main>
  );
}

function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

createRoot(document.getElementById("root")!).render(<App />);
