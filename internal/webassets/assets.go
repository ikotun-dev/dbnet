package webassets

import "embed"

// Files contains the statically exported Next.js application. Release and
// install builds populate out/ before compiling the Go executable.
//
// Next.js stores its generated assets under _next. The all: prefix is required
// because embed otherwise excludes files and directories whose names start
// with an underscore.
//
//go:embed all:out
var Files embed.FS
