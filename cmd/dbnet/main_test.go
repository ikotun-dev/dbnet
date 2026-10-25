package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCustomCATrustAndHostnameVerification(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "DBNet test CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err = x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"db.test.invalid"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err = x509.ParseCertificate(leafDER)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	cfg, err := connectionTLS(Profile{TLS: true, Host: "db.test.invalid", CACert: publicPEM})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.InsecureSkipVerify || cfg.ServerName != "db.test.invalid" {
		t.Fatal("certificate verification must remain enabled")
	}
	if _, err = leaf.Verify(x509.VerifyOptions{Roots: cfg.RootCAs, DNSName: cfg.ServerName}); err != nil {
		t.Fatal("uploaded CA should trust server", err)
	}
	if _, err = leaf.Verify(x509.VerifyOptions{Roots: cfg.RootCAs, DNSName: "wrong.test.invalid"}); err == nil {
		t.Fatal("hostname mismatch was accepted")
	}
	if _, err = leaf.Verify(x509.VerifyOptions{Roots: x509.NewCertPool(), DNSName: cfg.ServerName}); err == nil {
		t.Fatal("untrusted CA was accepted")
	}
	caOnly, err := connectionTLS(Profile{TLSMode: "verify-ca", Host: "wrong.test.invalid", CACert: publicPEM})
	if err != nil {
		t.Fatal(err)
	}
	if caOnly.VerifyConnection == nil {
		t.Fatal("verify-ca must explicitly verify the chain")
	}
	if err = caOnly.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}}); err != nil {
		t.Fatal("CA-only mode should not check hostname", err)
	}
	if err = caOnly.VerifyConnection(tls.ConnectionState{}); err == nil {
		t.Fatal("missing certificate must fail")
	}
	for _, p := range []Profile{{TLS: false, CACert: publicPEM}, {TLS: true, CACert: "invalid"}, {TLS: true, CACert: publicPEM + "\n-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----"}} {
		if _, err = connectionTLS(p); err == nil {
			t.Fatal("invalid CA configuration accepted")
		}
	}
}

func TestEncryptionOnlyHandshakeAndVerifiedRejection(t *testing.T) {
	service := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer service.Close()
	for _, mode := range []string{"require", "verify-full"} {
		cfg, err := connectionTLS(Profile{Host: "127.0.0.1", TLSMode: mode})
		if err != nil {
			t.Fatal(err)
		}
		transport := &http.Transport{TLSClientConfig: cfg}
		client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
		response, err := client.Get(service.URL)
		if mode == "require" {
			if err != nil {
				t.Fatal("encrypted-only must accept unknown issuer", err)
			}
			response.Body.Close()
		} else if err == nil {
			response.Body.Close()
			t.Fatal("verified TLS must reject unknown issuer")
		}
		transport.CloseIdleConnections()
	}
	if _, err := connectionTLS(Profile{TLSMode: "prefer"}); err == nil {
		t.Fatal("implicit TLS fallback must not be supported")
	}
}

func TestPostgresSessionIntegration(t *testing.T) {
	if os.Getenv("DBNET_TEST_POSTGRES") != "1" {
		t.Skip("set DBNET_TEST_POSTGRES=1 with isolated PostgreSQL on port 55439")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := open(ctx, Profile{Driver: "postgres", Host: "127.0.0.1", Port: "55439", User: "dbnet_test", Database: "postgres"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.close()
	for _, stmt := range []string{"CREATE TEMP TABLE dbnet_check (id bigint, note text)", "BEGIN", "INSERT INTO dbnet_check VALUES (9223372036854775807,NULL)", "COMMIT"} {
		if _, err = query(ctx, s, stmt); err != nil {
			t.Fatal(stmt, err)
		}
	}
	r, err := query(ctx, s, "SELECT * FROM dbnet_check")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != 1 || r.Rows[0][0] != "9223372036854775807" || r.Rows[0][1] != nil {
		t.Fatalf("unexpected result: %+v", r)
	}
	r, err = query(ctx, s, "SELECT generate_series(1,1100)")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != 1000 || !r.Truncated {
		t.Fatal("row cap not enforced")
	}
	if _, err = query(ctx, s, "SELECT * FROM dbnet_check"); err != nil {
		t.Fatal("session unusable after cap", err)
	}
	if _, err = query(ctx, s, "SELECT definitely_invalid_column"); err == nil {
		t.Fatal("expected SQL error")
	}
	if _, err = query(ctx, s, "SELECT 1"); err != nil {
		t.Fatal("session unusable after error", err)
	}
	r, err = query(ctx, s, "SELECT 12345678901234567890.123456789::numeric, '550e8400-e29b-41d4-a716-446655440000'::uuid")
	if err != nil || r.Rows[0][0] != "12345678901234567890.123456789" || r.Rows[0][1] != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("lossless database text: %+v %v", r, err)
	}
}

func TestProfilesNeverPersistPasswords(t *testing.T) {
	s := &server{path: filepath.Join(t.TempDir(), "connections.json"), profiles: []Profile{}, sessions: map[string]*session{}}
	req := httptest.NewRequest("POST", "http://localhost/api/connections", strings.NewReader(`{"name":"dev","driver":"postgres","host":"localhost","port":"5432","user":"tester","password":"must-not-persist"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.api(w, req)
	if w.Code != 201 {
		t.Fatalf("save: %d %s", w.Code, w.Body.String())
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "must-not-persist") || strings.Contains(w.Body.String(), "must-not-persist") {
		t.Fatal("password leaked")
	}
	var profiles []Profile
	if err = json.Unmarshal(data, &profiles); err != nil || len(profiles) != 1 {
		t.Fatal("profile not persisted", err)
	}
	info, _ := os.Stat(s.path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("profile permissions must be 0600")
	}
}

func TestUpdateColorAndDeleteProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connections.json")
	s := &server{path: path, profiles: []Profile{{ID: "saved-1", Name: "dev", Driver: "postgres", Host: "localhost", Port: "5432", User: "tester"}}, sessions: map[string]*session{}}
	request := func(method, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://localhost/api/connections", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.api(w, req)
		return w
	}

	w := request("PATCH", `{"id":"saved-1","name":"production","driver":"postgres","host":"localhost","port":"5432","user":"tester","password":"do-not-save","color":"#af52de"}`)
	if w.Code != 200 {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}
	if len(s.profiles) != 1 || s.profiles[0].Name != "production" || s.profiles[0].Color != "#af52de" || s.profiles[0].Password != "" {
		t.Fatalf("profile not updated safely: %+v", s.profiles)
	}
	data, err := os.ReadFile(path)
	if err != nil || strings.Contains(string(data), "do-not-save") {
		t.Fatalf("updated password leaked: %v %s", err, data)
	}

	w = request("PATCH", `{"id":"saved-1","name":"production","driver":"postgres","host":"localhost","port":"5432","user":"tester","color":"purple"}`)
	if w.Code != 400 {
		t.Fatalf("invalid color accepted: %d %s", w.Code, w.Body.String())
	}

	w = request("DELETE", `{"id":"saved-1"}`)
	if w.Code != 200 || len(s.profiles) != 0 {
		t.Fatalf("delete: %d %s profiles=%+v", w.Code, w.Body.String(), s.profiles)
	}
}

func TestRejectCrossOriginAndFormWrites(t *testing.T) {
	s := &server{profiles: []Profile{}, sessions: map[string]*session{}}
	for _, tc := range []struct {
		origin, content string
		want            int
	}{{"https://attacker.invalid", "application/json", 403}, {"", "text/plain", 400}} {
		r := httptest.NewRequest("POST", "http://localhost/api/connections", strings.NewReader(`{}`))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", tc.content)
		w := httptest.NewRecorder()
		s.api(w, r)
		if w.Code != tc.want {
			t.Fatalf("got %d want %d", w.Code, tc.want)
		}
	}
}

func TestExpiredSessionAndLargeIntegers(t *testing.T) {
	s := &server{sessions: map[string]*session{}}
	r := httptest.NewRequest("POST", "http://localhost/api/query", strings.NewReader(`{"session":"expired","sql":"SELECT 1"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.api(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "reconnect") {
		t.Fatal(w.Body.String())
	}
	if got := value(int64(9223372036854775807)); got != "9223372036854775807" {
		t.Fatalf("integer precision lost: %v", got)
	}
	if value(nil) != nil {
		t.Fatal("NULL lost")
	}
}
