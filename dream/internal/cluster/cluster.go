package cluster

import (
	"sort"
	"strings"
	"unicode"

	"github.com/bmelton/hablo-installer/dream/internal/model"
)

func TextKey(s string) string {
	words := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	set := map[string]bool{}
	for _, w := range words {
		if len(w) > 1 {
			set[w] = true
		}
	}
	words = words[:0]
	for w := range set {
		words = append(words, w)
	}
	sort.Strings(words)
	return strings.Join(words, " ")
}

func Group(in []model.Evidence, maxClusters, maxEvidence int) ([]model.Cluster, int) {
	m := map[string][]model.Evidence{}
	for _, e := range in {
		m[e.Key] = append(m[e.Key], e)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(m[keys[i]]) != len(m[keys[j]]) {
			return len(m[keys[i]]) > len(m[keys[j]])
		}
		return keys[i] < keys[j]
	})
	overflow := 0
	if len(keys) > maxClusters {
		overflow = len(keys) - maxClusters
		keys = keys[:maxClusters]
	}
	out := make([]model.Cluster, 0, len(keys))
	for _, k := range keys {
		ev := m[k]
		sort.Slice(ev, func(i, j int) bool { return ev[i].ID < ev[j].ID })
		shown := ev
		if len(shown) > maxEvidence {
			shown = shown[:maxEvidence]
		}
		out = append(out, model.Cluster{Key: k, Kind: ev[0].Kind, Count: len(ev), Evidence: shown})
	}
	return out, overflow
}
