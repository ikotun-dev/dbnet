package webassets

import "embed"

// Files contains the statically exported Next.js application. Release and
// install builds populate out/ before compiling the Go executable.
//
//go:embed out
var Files embed.FS
