package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"mind-journey-app/internal/knowledge"
)

//go:embed all:dist
var dist embed.FS

func main() {
	addr := fmt.Sprintf(":%s", getenv("PORT", "8090"))
	contentDir := flag.String("content", getenv("KNOWLEDGE_BASE_DIR", ""), "directory with markdown notes")
	flag.Parse()

	store, err := knowledge.Load(*contentDir)
	if err != nil {
		log.Printf("content load warning: %v; falling back to bundled seed", err)
		store = knowledge.Seed()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/library", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, store.Library())
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok"})
	})

	static, err := fs.Sub(dist, "dist")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", spaHandler(static))

	server := &http.Server{
		Addr:              addr,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("Mind Journey is listening on http://localhost%s", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown failed: %v", err)
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func spaHandler(static fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(static))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		name := strings.TrimPrefix(filepath.Clean(r.URL.Path), string(filepath.Separator))
		if name == "." || name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(static, name); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
