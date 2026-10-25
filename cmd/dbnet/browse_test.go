package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestIdentifierQuoting(t *testing.T) {
	if quoteIdentifier(`customer"list`, true) != `"customer""list"` {
		t.Fatal("PostgreSQL identifier escaping failed")
	}
	if quoteIdentifier("customer`list", false) != "`customer``list`" {
		t.Fatal("MySQL identifier escaping failed")
	}
	for _, r := range []browseRequest{{Schema: "public", Table: "users", Offset: -1}, {Schema: "public", Table: "users", Limit: 501}, {Schema: "public", Table: "users", Limit: -1}} {
		if _, e := browse(context.Background(), &session{}, r); e == nil {
			t.Fatal("invalid page accepted")
		}
	}
}

func TestBrowsePostgresIntegration(t *testing.T) {
	if os.Getenv("DBNET_TEST_POSTGRES") != "1" {
		t.Skip("requires isolated PostgreSQL on port 55439")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	s, err := open(ctx, Profile{Driver: "postgres", Host: "127.0.0.1", Port: "55439", User: "dbnet_test", Database: "postgres"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.close()
	schema := fmt.Sprintf("dbnet_browse_%d", time.Now().UnixNano())
	qSchema := quoteIdentifier(schema, true)
	table := `customer"list`
	qTable := qSchema + "." + quoteIdentifier(table, true)
	if _, err = query(ctx, s, "CREATE SCHEMA "+qSchema); err != nil {
		t.Fatal(err)
	}
	defer query(context.Background(), s, "DROP SCHEMA "+qSchema+" CASCADE")
	for _, sql := range []string{"CREATE TABLE " + qTable + " (id bigint PRIMARY KEY, email text, balance numeric(20,4))", "INSERT INTO " + qTable + " SELECT n, 'customer_' || n || '@example.test', n * 10.1234 FROM generate_series(1,235) AS n"} {
		if _, err = query(ctx, s, sql); err != nil {
			t.Fatal(err)
		}
	}
	req := browseRequest{Schema: schema, Table: table, Limit: 100}
	first, err := browse(ctx, s, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Rows) != 100 || !first.HasNext || first.Rows[0][0] != "1" || len(first.Structure) != 3 || len(first.PrimaryKeys) != 1 {
		t.Fatalf("first page: %+v", first)
	}
	req.Offset = 100
	second, err := browse(ctx, s, req)
	if err != nil || len(second.Rows) != 100 || second.Rows[0][0] != "101" {
		t.Fatalf("second page: %+v %v", second, err)
	}
	req.Offset = 200
	last, err := browse(ctx, s, req)
	if err != nil || len(last.Rows) != 35 || last.HasNext {
		t.Fatalf("last page: %+v %v", last, err)
	}
	req.Offset = 0
	req.Sort = "id"
	req.Desc = true
	sorted, err := browse(ctx, s, req)
	if err != nil || sorted.Rows[0][0] != "235" {
		t.Fatal("sorting", err)
	}
	req.FilterColumn = "email"
	req.FilterValue = "customer_12@"
	filtered, err := browse(ctx, s, req)
	if err != nil || len(filtered.Rows) != 1 || filtered.Rows[0][0] != "12" {
		t.Fatal("filtering", err)
	}
	req.FilterValue = "' OR TRUE --"
	filtered, err = browse(ctx, s, req)
	if err != nil || len(filtered.Rows) != 0 {
		t.Fatal("filter must remain a literal parameter", err)
	}
	req.Sort = "id; DROP TABLE users"
	if _, err = browse(ctx, s, req); err == nil || !strings.Contains(err.Error(), "sort") {
		t.Fatal("unknown sort must fail")
	}
}
