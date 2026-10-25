package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	iofs "io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/ikotun-dev/dbnet/internal/webassets"
	"github.com/jackc/pgx/v5"
)

type Profile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Database string `json:"database"`
	TLS      bool   `json:"tls"`
	TLSMode  string `json:"tlsMode,omitempty"`
	CACert   string `json:"caCert,omitempty"`
	Password string `json:"password,omitempty"`
	Color    string `json:"color,omitempty"`
}
type session struct {
	mu   sync.Mutex
	pg   *pgx.Conn
	my   *sql.Conn
	pool *sql.DB
}

func (s *session) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pg != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second*3)
		defer cancel()
		s.pg.Close(ctx)
	}
	if s.my != nil {
		s.my.Close()
		s.pool.Close()
	}
}

type server struct {
	mu       sync.Mutex
	profiles []Profile
	sessions map[string]*session
	path     string
}

var profileColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// installRoot is an optional build-time migration source for local installs
// created before profiles moved into the OS user configuration directory.
var installRoot string

func validateProfile(p Profile) error {
	if p.Name == "" || p.Host == "" || p.User == "" || (p.Driver != "postgres" && p.Driver != "mysql") {
		return errors.New("name, host, user and supported driver required")
	}
	if p.Color != "" && !profileColorPattern.MatchString(p.Color) {
		return errors.New("connection color must be a six-digit hex color")
	}
	_, err := connectionTLS(p)
	return err
}

func (s *server) persistProfiles(next []Profile) error {
	b, err := json.MarshalIndent(next, "", "  ")
	if err == nil {
		err = os.WriteFile(s.path+".tmp", b, 0600)
	}
	if err == nil {
		err = os.Rename(s.path+".tmp", s.path)
	}
	return err
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, err error) {
	var authority x509.UnknownAuthorityError
	if errors.As(err, &authority) {
		err = errors.New("Verified TLS could not trust the server certificate. Add your provider's CA certificate, or explicitly choose Encrypted only (require) if you do not need server identity verification. DBNet will not downgrade automatically.")
	}
	respond(w, 400, map[string]string{"error": err.Error()})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		logged := r.URL.Path == "/" || strings.HasPrefix(r.URL.Path, "/api/")
		if !logged {
			next.ServeHTTP(w, r)
			return
		}
		writer := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(writer, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, writer.status, time.Since(started).Round(time.Millisecond))
	})
}

func connectionTLS(p Profile) (*tls.Config, error) {
	mode := p.TLSMode
	if mode == "" {
		if p.TLS {
			mode = "verify-full"
		} else {
			mode = "disable"
		}
	}
	if mode != "disable" && mode != "require" && mode != "verify-ca" && mode != "verify-full" {
		return nil, errors.New("unsupported TLS mode")
	}
	if mode == "disable" {
		if strings.TrimSpace(p.CACert) != "" {
			return nil, errors.New("enable TLS to use a CA certificate")
		}
		return nil, nil
	}
	cfg := &tls.Config{ServerName: p.Host, MinVersion: tls.VersionTLS12}
	if mode == "require" {
		// Explicit encryption-only mode: never used as a verification fallback.
		if strings.TrimSpace(p.CACert) != "" {
			return nil, errors.New("choose verified TLS to use a CA certificate")
		}
		cfg.InsecureSkipVerify = true
		return cfg, nil
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	remaining := []byte(strings.TrimSpace(p.CACert))
	count := 0
	for len(strings.TrimSpace(string(remaining))) > 0 {
		block, rest := pem.Decode(remaining)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, errors.New("upload a PEM CA certificate containing only CERTIFICATE blocks, not a private key")
		}
		cert, e := x509.ParseCertificate(block.Bytes)
		if e != nil || !cert.IsCA {
			return nil, errors.New("the uploaded file must contain valid CA certificates")
		}
		roots.AddCert(cert)
		count++
		remaining = rest
	}
	if count == 0 && strings.TrimSpace(p.CACert) != "" {
		return nil, errors.New("no CA certificates found")
	}
	cfg.RootCAs = roots
	if mode == "verify-ca" {
		// Verify the chain explicitly, omitting only hostname matching.
		cfg.InsecureSkipVerify = true
		cfg.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("server did not present a certificate")
			}
			intermediates := x509.NewCertPool()
			for _, cert := range cs.PeerCertificates[1:] {
				intermediates.AddCert(cert)
			}
			_, err := cs.PeerCertificates[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates})
			return err
		}
	}
	return cfg, nil
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("application/json required")
	}
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v)
}
func open(ctx context.Context, p Profile) (*session, error) {
	if p.Host == "" || p.User == "" {
		return nil, errors.New("host and user are required")
	}
	tlsConfig, tlsErr := connectionTLS(p)
	if tlsErr != nil {
		return nil, tlsErr
	}
	if p.Driver == "postgres" {
		u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(p.Host, p.Port), Path: "/" + p.Database, User: url.UserPassword(p.User, p.Password)}
		q := u.Query()
		if tlsConfig != nil {
			q.Set("sslmode", "verify-full")
		} else {
			q.Set("sslmode", "disable")
		}
		u.RawQuery = q.Encode()
		cfg, e := pgx.ParseConfig(u.String())
		if e != nil {
			return nil, e
		}
		cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
		cfg.RuntimeParams["client_encoding"] = "UTF8"
		if tlsConfig != nil {
			cfg.TLSConfig = tlsConfig
		}
		c, e := pgx.ConnectConfig(ctx, cfg)
		if e != nil {
			return nil, e
		}
		return &session{pg: c}, nil
	}
	if p.Driver != "mysql" {
		return nil, errors.New("unsupported driver")
	}
	cfg := mysql.NewConfig()
	cfg.User = p.User
	cfg.Passwd = p.Password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(p.Host, p.Port)
	cfg.DBName = p.Database
	cfg.Timeout = 10 * time.Second
	if tlsConfig != nil {
		cfg.TLS = tlsConfig
	}
	connector, e := mysql.NewConnector(cfg)
	if e != nil {
		return nil, e
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(1)
	c, e := db.Conn(ctx)
	if e == nil {
		e = c.PingContext(ctx)
	}
	if e != nil {
		if c != nil {
			c.Close()
		}
		db.Close()
		return nil, e
	}
	return &session{my: c, pool: db}, nil
}

type result struct {
	Columns   []string `json:"columns"`
	Rows      [][]any  `json:"rows"`
	Duration  int64    `json:"duration"`
	Truncated bool     `json:"truncated"`
	Message   string   `json:"message"`
}

func value(v any) any {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case []byte:
		return string(x)
	case time.Time:
		return x.Format(time.RFC3339Nano)
	default:
		return fmt.Sprint(v)
	}
}
func query(ctx context.Context, s *session, text string, args ...any) (result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	start := time.Now()
	res := result{Columns: []string{}, Rows: [][]any{}}
	size := 0
	add := func(v []any) bool {
		row := make([]any, len(v))
		for i, x := range v {
			row[i] = value(x)
		}
		b, _ := json.Marshal(row)
		if len(res.Rows) >= 1000 || size+len(b) > 4<<20 {
			res.Truncated = true
			return false
		}
		size += len(b)
		res.Rows = append(res.Rows, row)
		return true
	}
	if s.pg != nil {
		rows, e := s.pg.Query(ctx, text, args...)
		if e != nil {
			return res, e
		}
		defer rows.Close()
		for _, f := range rows.FieldDescriptions() {
			res.Columns = append(res.Columns, f.Name)
		}
		for rows.Next() {
			// Simple protocol returns PostgreSQL's lossless text representation.
			// Preserve decimals, UUIDs and arrays without Go-specific formatting.
			raw := rows.RawValues()
			v := make([]any, len(raw))
			for i, b := range raw {
				if b != nil {
					v[i] = string(b)
				}
			}
			if !add(v) {
				break
			}
		}
		if !res.Truncated && rows.Err() != nil {
			return res, rows.Err()
		}
		rows.Close()
		res.Message = rows.CommandTag().String()
	} else {
		rows, e := s.my.QueryContext(ctx, text, args...)
		if e != nil {
			return res, e
		}
		defer rows.Close()
		res.Columns, e = rows.Columns()
		if e != nil {
			return res, e
		}
		for rows.Next() {
			v := make([]any, len(res.Columns))
			ptr := make([]any, len(v))
			for i := range v {
				ptr[i] = &v[i]
			}
			if e = rows.Scan(ptr...); e != nil {
				return res, e
			}
			if !add(v) {
				break
			}
		}
		if !res.Truncated && rows.Err() != nil {
			return res, rows.Err()
		}
		res.Message = "Statement completed"
	}
	res.Duration = time.Since(start).Milliseconds()
	return res, nil
}
func (s *server) api(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if origin := r.Header.Get("Origin"); origin != "" {
		u, e := url.Parse(origin)
		if e != nil || u.Host != r.Host {
			http.Error(w, "origin rejected", 403)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	switch r.URL.Path {
	case "/api/connections":
		if r.Method == "GET" {
			s.mu.Lock()
			defer s.mu.Unlock()
			respond(w, 200, s.profiles)
			return
		}
		if r.Method != "POST" && r.Method != "PATCH" && r.Method != "DELETE" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var p Profile
		if e := decode(w, r, &p); e != nil {
			fail(w, e)
			return
		}
		if r.Method == "DELETE" {
			if p.ID == "" {
				fail(w, errors.New("connection id required"))
				return
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			next := make([]Profile, 0, len(s.profiles))
			found := false
			for _, existing := range s.profiles {
				if existing.ID == p.ID {
					found = true
					continue
				}
				next = append(next, existing)
			}
			if !found {
				fail(w, errors.New("saved connection not found"))
				return
			}
			if err := s.persistProfiles(next); err != nil {
				fail(w, err)
				return
			}
			s.profiles = next
			respond(w, 200, map[string]bool{"deleted": true})
			return
		}
		if err := validateProfile(p); err != nil {
			fail(w, err)
			return
		}
		p.Password = ""
		if r.Method == "POST" {
			p.ID = fmt.Sprint(time.Now().UnixNano())
		} else if p.ID == "" {
			fail(w, errors.New("connection id required"))
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		next := append([]Profile{}, s.profiles...)
		if r.Method == "POST" {
			next = append(next, p)
		} else {
			found := false
			for i := range next {
				if next[i].ID == p.ID {
					next[i] = p
					found = true
					break
				}
			}
			if !found {
				fail(w, errors.New("saved connection not found"))
				return
			}
		}
		if err := s.persistProfiles(next); err != nil {
			fail(w, err)
			return
		}
		s.profiles = next
		status := 200
		if r.Method == "POST" {
			status = 201
		}
		respond(w, status, p)
	case "/api/connect", "/api/test":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var p Profile
		if e := decode(w, r, &p); e != nil {
			fail(w, e)
			return
		}
		c, e := open(ctx, p)
		if e != nil {
			fail(w, e)
			return
		}
		if r.URL.Path == "/api/test" {
			c.close()
			respond(w, 200, map[string]bool{"ok": true})
			return
		}
		id := fmt.Sprint(time.Now().UnixNano())
		s.mu.Lock()
		s.sessions[id] = c
		s.mu.Unlock()
		respond(w, 200, map[string]string{"session": id})
	case "/api/browse":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var req browseRequest
		if e := decode(w, r, &req); e != nil {
			fail(w, e)
			return
		}
		s.mu.Lock()
		c := s.sessions[req.Session]
		s.mu.Unlock()
		if c == nil {
			fail(w, errors.New("session expired; reconnect"))
			return
		}
		res, e := browse(ctx, c, req)
		if e != nil {
			fail(w, e)
			return
		}
		respond(w, 200, res)
	case "/api/query", "/api/tables", "/api/disconnect":
		if r.Method != "POST" {
			http.Error(w, "method not allowed", 405)
			return
		}
		var req struct {
			Session string `json:"session"`
			SQL     string `json:"sql"`
		}
		if e := decode(w, r, &req); e != nil {
			fail(w, e)
			return
		}
		s.mu.Lock()
		c := s.sessions[req.Session]
		if r.URL.Path == "/api/disconnect" {
			delete(s.sessions, req.Session)
		}
		s.mu.Unlock()
		if c == nil {
			fail(w, errors.New("session expired; reconnect"))
			return
		}
		if r.URL.Path == "/api/disconnect" {
			c.close()
			respond(w, 200, map[string]bool{"ok": true})
			return
		}
		if r.URL.Path == "/api/tables" {
			if c.pg != nil {
				req.SQL = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE' ORDER BY 1,2"
			} else {
				req.SQL = "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY 1,2"
			}
		}
		if strings.TrimSpace(req.SQL) == "" {
			fail(w, errors.New("SQL is empty"))
			return
		}
		res, e := query(ctx, c, req.SQL)
		if e != nil {
			fail(w, e)
			return
		}
		respond(w, 200, res)
	default:
		http.NotFound(w, r)
	}
}

func (s *server) closeAll() {
	s.mu.Lock()
	sessions := make([]*session, 0, len(s.sessions))
	for _, active := range s.sessions {
		sessions = append(sessions, active)
	}
	s.sessions = map[string]*session{}
	s.mu.Unlock()
	for _, active := range sessions {
		active.close()
	}
}

func main() {
	if len(os.Args) != 2 || os.Args[1] != "run" {
		fmt.Fprintln(os.Stderr, "Usage: dbnet run")
		os.Exit(2)
	}
	dir := os.Getenv("DBNET_DATA_DIR")
	if dir == "" {
		configDir, err := os.UserConfigDir()
		if err != nil {
			log.Fatal("locate user configuration directory: ", err)
		}
		dir = filepath.Join(configDir, "dbnet")
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		log.Fatal(e)
	}
	s := &server{profiles: []Profile{}, sessions: map[string]*session{}, path: filepath.Join(dir, "connections.json")}
	if installRoot != "" {
		legacyPath := filepath.Join(installRoot, "data", "connections.json")
		if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
			if legacyData, legacyErr := os.ReadFile(legacyPath); legacyErr == nil {
				if writeErr := os.WriteFile(s.path, legacyData, 0600); writeErr != nil {
					log.Fatal("migrate existing connection profiles: ", writeErr)
				}
				log.Printf("Migrated connection profiles to %s", s.path)
			}
		}
	}
	if b, e := os.ReadFile(s.path); e == nil {
		if e = json.Unmarshal(b, &s.profiles); e != nil {
			log.Fatal("invalid connection store: ", e)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", s.api)
	webFiles, err := iofs.Sub(webassets.Files, "out")
	if err != nil {
		log.Fatal("load embedded frontend: ", err)
	}
	if _, err := iofs.Stat(webFiles, "index.html"); err != nil {
		log.Fatal("embedded frontend is missing; build DBNet with synced web assets")
	}
	mux.Handle("/", http.FileServer(http.FS(webFiles)))
	port := os.Getenv("DBNET_PORT")
	if port == "" {
		port = "47831"
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		log.Fatal("DBNET_PORT must be between 1 and 65535")
	}
	addr := net.JoinHostPort("127.0.0.1", port)
	httpServer := &http.Server{Addr: addr, Handler: logRequests(mux), ReadHeaderTimeout: 5 * time.Second}
	errCh := make(chan error, 1)
	go func() {
		err := httpServer.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		errCh <- err
	}()
	log.Printf("DBNet listening at http://%s", addr)
	log.Printf("Press Ctrl+C to stop")
	stops := make(chan os.Signal, 1)
	signal.Notify(stops, os.Interrupt, syscall.SIGTERM)
	select {
	case sig := <-stops:
		log.Printf("Stopping DBNet (%s)…", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
		s.closeAll()
		log.Printf("DBNet stopped")
	case err := <-errCh:
		if err != nil {
			log.Fatal(err)
		}
	}
}
