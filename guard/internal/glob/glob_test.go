package glob

import "testing"

func TestMatch(t *testing.T) {
	cases := []struct {
		pat, name string
		want      bool
	}{
		{"**/.env", "/home/a/proj/.env", true},
		{"**/.env.*", "/x/.env.local", true},
		{"**/*.pem", "/a/b/key.pem", true},
		{"**/node_modules/**", "/p/node_modules/x/y", true},
		{"src/*.go", "src/a.go", true},
		{"src/*.go", "src/nested/a.go", false},
		{"**/*_gen.go", "pkg/foo_gen.go", true},
		{"**/id_rsa", "/home/u/.ssh/id_rsa", true},
		{"foo", "bar", false},
	}
	for _, c := range cases {
		if got := Match(c.pat, c.name); got != c.want {
			t.Errorf("Match(%q,%q)=%v want %v", c.pat, c.name, got, c.want)
		}
	}
}
