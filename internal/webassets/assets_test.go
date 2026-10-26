package webassets

import (
	"errors"
	"io/fs"
	"strings"
	"testing"
)

func TestBuiltFrontendIncludesNextAssets(t *testing.T) {
	if _, err := Files.Open("out/index.html"); errors.Is(err, fs.ErrNotExist) {
		t.Skip("frontend assets have not been synced")
	} else if err != nil {
		t.Fatal(err)
	}

	var css, javascript bool
	err := fs.WalkDir(Files, "out/_next", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		css = css || strings.HasSuffix(path, ".css")
		javascript = javascript || strings.HasSuffix(path, ".js")
		return nil
	})
	if err != nil {
		t.Fatalf("walk embedded Next.js assets: %v", err)
	}
	if !css || !javascript {
		t.Fatalf("embedded frontend is incomplete: css=%t javascript=%t", css, javascript)
	}
}
