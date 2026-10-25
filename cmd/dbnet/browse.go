package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type browseRequest struct {
	Session      string `json:"session"`
	Schema       string `json:"schema"`
	Table        string `json:"table"`
	Offset       int    `json:"offset"`
	Limit        int    `json:"limit"`
	Sort         string `json:"sort"`
	Desc         bool   `json:"desc"`
	FilterColumn string `json:"filterColumn"`
	FilterValue  string `json:"filterValue"`
}
type browseResult struct {
	result
	Structure   [][]any  `json:"structure"`
	PrimaryKeys []string `json:"primaryKeys"`
	HasNext     bool     `json:"hasNext"`
	Offset      int      `json:"offset"`
}

func quoteIdentifier(s string, postgres bool) string {
	q := "`"
	if postgres {
		q = "\""
	}
	return q + strings.ReplaceAll(s, q, q+q) + q
}

func browse(ctx context.Context, s *session, req browseRequest) (browseResult, error) {
	out := browseResult{PrimaryKeys: []string{}, Offset: req.Offset}
	if req.Schema == "" || req.Table == "" || strings.ContainsRune(req.Schema, 0) || strings.ContainsRune(req.Table, 0) {
		return out, errors.New("schema and table are required")
	}
	if req.Offset < 0 || req.Offset > 1_000_000_000 {
		return out, errors.New("invalid page offset")
	}
	if req.Limit == 0 {
		req.Limit = 100
	}
	if req.Limit < 1 || req.Limit > 500 {
		return out, errors.New("page size must be between 1 and 500")
	}
	pg := s.pg != nil
	schemaParam, tableParam := "?", "?"
	if pg {
		schemaParam = "$1"
		tableParam = "$2"
	}
	metadata, err := query(ctx, s, "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema="+schemaParam+" AND table_name="+tableParam+" ORDER BY ordinal_position", req.Schema, req.Table)
	if err != nil {
		return out, err
	}
	if len(metadata.Rows) == 0 {
		return out, errors.New("table not found or no permission to inspect it")
	}
	out.Structure = metadata.Rows
	allowed := map[string]bool{}
	for _, r := range metadata.Rows {
		allowed[fmt.Sprint(r[0])] = true
	}
	if req.Sort != "" && !allowed[req.Sort] {
		return out, errors.New("unknown sort column")
	}
	if req.FilterValue != "" && !allowed[req.FilterColumn] {
		return out, errors.New("choose a valid filter column")
	}
	pkSQL := "SELECT column_name FROM information_schema.key_column_usage WHERE table_schema=? AND table_name=? AND constraint_name='PRIMARY' ORDER BY ordinal_position"
	if pg {
		pkSQL = "SELECT a.attname FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, position) ON k.position<=i.indnkeyatts JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indisprimary AND n.nspname=$1 AND c.relname=$2 ORDER BY k.position"
	}
	pk, err := query(ctx, s, pkSQL, req.Schema, req.Table)
	if err != nil {
		return out, err
	}
	for _, r := range pk.Rows {
		out.PrimaryKeys = append(out.PrimaryKeys, fmt.Sprint(r[0]))
	}
	statement := "SELECT * FROM " + quoteIdentifier(req.Schema, pg) + "." + quoteIdentifier(req.Table, pg)
	args := []any{}
	if req.FilterValue != "" {
		args = append(args, req.FilterValue)
		col := quoteIdentifier(req.FilterColumn, pg)
		if pg {
			statement += " WHERE strpos(CAST(" + col + " AS TEXT), $1)>0"
		} else {
			statement += " WHERE INSTR(CAST(" + col + " AS CHAR), ?)>0"
		}
	}
	order := []string{}
	if req.Sort != "" {
		direction := " ASC"
		if req.Desc {
			direction = " DESC"
		}
		order = append(order, quoteIdentifier(req.Sort, pg)+direction)
	}
	for _, key := range out.PrimaryKeys {
		if key != req.Sort {
			order = append(order, quoteIdentifier(key, pg)+" ASC")
		}
	}
	if len(order) > 0 {
		statement += " ORDER BY " + strings.Join(order, ", ")
	}
	statement += fmt.Sprintf(" LIMIT %d OFFSET %d", req.Limit+1, req.Offset)
	out.result, err = query(ctx, s, statement, args...)
	if err != nil {
		return out, err
	}
	out.HasNext = len(out.Rows) > req.Limit || out.Truncated
	if len(out.Rows) > req.Limit {
		out.Rows = out.Rows[:req.Limit]
	}
	if len(out.Rows) == 0 {
		out.HasNext = false
	}
	return out, nil
}
