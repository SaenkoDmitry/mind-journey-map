import React, { Component, useEffect, useMemo, useRef, useState } from "react";
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
type Route = { mode: Mode; topicSlug?: string; sectionSlug?: string };

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
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [readSectionSlug, setReadSectionSlug] = useState(route.sectionSlug);

  useEffect(() => {
    const handleHashChange = () => {
      const nextRoute = parseRoute(window.location.hash);
      setRoute(nextRoute);
      setReadSectionSlug(nextRoute.sectionSlug);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    fetch("/api/library")
      .then((response) => {
        if (!response.ok) throw new Error("Library request failed");
        return response.json() as Promise<Library>;
      })
      .then((data) => {
        setLibrary(data);
        const routedTopic = topicBySlug(data.topics, route.topicSlug);
        setMode(route.mode);
        setSelectedTopicId((current) => routedTopic?.id || current || data.topics[0]?.id || "");
        localStorage.setItem("mind-journey-library", JSON.stringify(data));
      })
      .catch(() => {
        const cached = localStorage.getItem("mind-journey-library");
        if (cached) {
          const data = JSON.parse(cached) as Library;
          setLibrary(data);
          const routedTopic = topicBySlug(data.topics, route.topicSlug);
          setMode(route.mode);
          setSelectedTopicId(routedTopic?.id || data.topics[0]?.id || "");
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
    if (!library) return;
    const routedTopic = topicBySlug(library.topics, route.topicSlug);
    setMode(route.mode);
    if (route.mode === "review" && !route.topicSlug) {
      setSelectedTopicId((current) => (current === "all" ? current : "all"));
      return;
    }
    if (routedTopic) {
      setSelectedTopicId((current) => (current === routedTopic.id ? current : routedTopic.id));
    } else {
      setSelectedTopicId((current) => current || library.topics[0]?.id || "");
    }
  }, [library, route]);

  useEffect(() => {
    setActiveCardId("");
    setAnswerVisible(false);
  }, [selectedTopicId]);

  function changeMode(nextMode: Mode) {
    const topic = selectedTopicId === "all" ? library?.topics[0] : selectedTopic;
    navigate(nextMode, nextMode === "review" && selectedTopicId === "all" ? undefined : topic);
  }

  function changeTopic(topicID: string) {
    if (topicID === "all") {
      navigate("review");
      return;
    }
    const topic = library?.topics.find((item) => item.id === topicID);
    navigate(mode, topic);
  }

  function openTopicByTitle(title: string) {
    const topic = topicLookup.get(normalizeTitle(title));
    if (!topic) return;
    navigate("book", topic);
  }

  function navigate(nextMode: Mode, topic?: Topic, section?: Section, replace = false) {
    const nextHash = routeHash(nextMode, topic, section);
    if (window.location.hash === nextHash) {
      setMode(nextMode);
      setSelectedTopicId(topic?.id || (nextMode === "review" ? "all" : library?.topics[0]?.id || ""));
      setReadSectionSlug(section ? slugify(section.title) : undefined);
      scrollToSection(section);
      return;
    }
    if (replace) {
      window.history.replaceState(null, "", nextHash);
      setRoute(parseRoute(nextHash));
    } else {
      window.location.hash = nextHash;
    }
  }

  function markReadSection(topic: Topic, section: Section) {
    const nextHash = routeHash("book", topic, section);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
    setReadSectionSlug(slugify(section.title));
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
        {mode === "book" && selectedTopic && (
          <BookView
            key={selectedTopic.id}
            topic={selectedTopic}
            activeSectionSlug={readSectionSlug || route.sectionSlug}
            scrollSectionSlug={route.sectionSlug}
            onOpenTopic={openTopicByTitle}
            onOpenSection={(section) => navigate("book", selectedTopic, section)}
            onReadSection={(section) => markReadSection(selectedTopic, section)}
          />
        )}
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

function BookView({
  topic,
  activeSectionSlug,
  scrollSectionSlug,
  onOpenTopic,
  onOpenSection,
  onReadSection
}: {
  topic: Topic;
  activeSectionSlug?: string;
  scrollSectionSlug?: string;
  onOpenTopic: (title: string) => void;
  onOpenSection: (section: Section) => void;
  onReadSection: (section: Section) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  function handleMarkdownClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const wikiLink = target.closest<HTMLElement>("[data-topic-title]");
    if (!wikiLink) return;
    onOpenTopic(wikiLink.dataset.topicTitle || "");
  }

  useEffect(() => {
    const section = sectionBySlug(topic, scrollSectionSlug);
    if (section) {
      window.requestAnimationFrame(() => scrollToSection(section));
    } else {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [scrollSectionSlug, topic]);

  useEffect(() => {
    if (!contentRef.current || topic.sections.length <= 1) return undefined;
    const observed = new Map<Element, Section>();
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];
        const section = visible ? observed.get(visible.target) : undefined;
        if (section) onReadSection(section);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.1, 0.3] }
    );

    for (const section of topic.sections) {
      const element = document.getElementById(section.id);
      if (!element) continue;
      observed.set(element, section);
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [onReadSection, topic]);

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
              <button
                key={`${topic.id}-${section.id}`}
                className={slugify(section.title) === activeSectionSlug ? "active" : ""}
                onClick={() => onOpenSection(section)}
                style={{ paddingLeft: `${Math.max(section.level - 1, 0) * 10}px` }}
                type="button"
              >
                {section.title}
              </button>
            ))}
          </nav>
        ) : (
          <></>
        )}

        <div className="markdown-body" ref={contentRef}>
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
  | { type: "table"; headers: string[]; rows: string[][]; align: Array<"left" | "center" | "right"> }
  | { type: "list"; ordered: boolean; items: { text: string; checked?: boolean }[] }
  | { type: "code"; language: string; code: string }
  | { type: "hr" };

function parseMarkdown(markdown = "") {
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

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      const align = splitTableRow(lines[index + 1]).map(tableAlign);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(normalizeTableRow(splitTableRow(lines[index]), headers.length));
        index++;
      }
      nodes.push({ type: "table", headers, rows, align });
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
      if (!next || next.startsWith(">") || next.startsWith("```") || /^---+$/.test(next) || isListLine(next) || isTableStart(lines, index)) break;
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
  if (node.type === "table") {
    return (
      <div className="table-scroll" key={index}>
        <table>
          <thead>
            <tr>
              {node.headers.map((header, cellIndex) => (
                <th key={`${header}-${cellIndex}`} style={{ textAlign: node.align[cellIndex] || "left" }}>
                  <span dangerouslySetInnerHTML={{ __html: inlineMarkdown(header) }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {node.headers.map((_header, cellIndex) => (
                  <td key={cellIndex} style={{ textAlign: node.align[cellIndex] || "left" }}>
                    <span dangerouslySetInnerHTML={{ __html: inlineMarkdown(row[cellIndex] || "") }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
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

function isTableStart(lines: string[], index: number) {
  const current = lines[index]?.trim() || "";
  const next = lines[index + 1]?.trim() || "";
  return isTableRow(current) && isTableSeparator(next) && splitTableRow(current).length >= 2;
}

function isTableRow(value: string) {
  return value.startsWith("|") && value.endsWith("|") && value.split("|").length >= 3;
}

function isTableSeparator(value: string) {
  if (!isTableRow(value)) return false;
  return splitTableRow(value).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(value: string) {
  return value
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeTableRow(cells: string[], length: number) {
  if (cells.length >= length) return cells.slice(0, length);
  return [...cells, ...Array.from({ length: length - cells.length }, () => "")];
}

function tableAlign(value: string): "left" | "center" | "right" {
  const trimmed = value.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function inlineMarkdown(value = "") {
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

function escapeHTML(value = "") {
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

function parseRoute(hash: string): Route {
  const cleanHash = hash.replace(/^#\/?/, "");
  if (!cleanHash) return { mode: "book" };
  const [modePart, topicSlug, sectionSlug] = cleanHash.split("/").map((part) => decodeURIComponent(part || ""));
  if (modePart === "review") return { mode: "review", topicSlug };
  if (modePart === "book") return { mode: "book", topicSlug, sectionSlug };
  return { mode: "book" };
}

function routeHash(mode: Mode, topic?: Topic, section?: Section) {
  const parts: string[] = [mode];
  if (topic) parts.push(slugify(topic.title));
  if (topic && section) parts.push(slugify(section.title));
  return `#/${parts.map(encodeURIComponent).join("/")}`;
}

function topicBySlug(topics: Topic[], topicSlug?: string) {
  if (!topicSlug) return undefined;
  return topics.find((topic) => slugify(topic.title) === topicSlug || slugify(topic.path.replace(/\.md$/i, "")) === topicSlug);
}

function sectionBySlug(topic: Topic, sectionSlug?: string) {
  if (!sectionSlug) return undefined;
  return topic.sections.find((section) => slugify(section.title) === sectionSlug);
}

function slugify(value: string) {
  return normalizeTitle(value)
    .replace(/\.md$/i, "")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function scrollToSection(section?: Section) {
  if (!section) return;
  const element = document.getElementById(section.id);
  element?.scrollIntoView({ behavior: "smooth", block: "start" });
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

class AppErrorBoundary extends Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="error-screen">
          <h1>Не удалось отрисовать страницу</h1>
          <p>Скорее всего, попался неожиданный markdown или устаревший якорь в адресе. Можно вернуться к началу книги.</p>
          <button
            onClick={() => {
              window.location.hash = "#/book";
              window.location.reload();
            }}
          >
            Открыть книгу
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
