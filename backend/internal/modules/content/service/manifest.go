package service

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// ManifestFormatVersion is the manifest format this seed understands.
const ManifestFormatVersion = 1

// Manifest is the content artifact produced by the extractor (SPEC-005).
type Manifest struct {
	FormatVersion       int                `json:"formatVersion"`
	GeneratedFrom       string             `json:"generatedFrom"`
	ContentHash         string             `json:"contentHash"`
	Modules             []ManifestModule   `json:"modules"`
	Scenarios           []ManifestScenario `json:"scenarios"`
	Questions           []ManifestQuestion `json:"questions"`
	AssessmentTemplates []ManifestTemplate `json:"assessmentTemplates"`
}

// ManifestModule is a learning module with its ordered blocks.
type ManifestModule struct {
	SourceKey    string          `json:"sourceKey"`
	Slug         string          `json:"slug,omitempty"`
	Title        string          `json:"title"`
	Description  string          `json:"description"`
	Icon         string          `json:"icon"`
	Color        string          `json:"color"`
	DisplayOrder int             `json:"displayOrder"`
	Visibility   string          `json:"visibility"`
	Blocks       []ManifestBlock `json:"blocks"`
}

// ManifestBlock is a content block.
type ManifestBlock struct {
	SourceKey string           `json:"sourceKey"`
	Type      domain.BlockType `json:"type"`
	Payload   json.RawMessage  `json:"payload"`
}

// ManifestScenario is a serialized machine state.
type ManifestScenario struct {
	SourceKey     string          `json:"sourceKey"`
	BaseSourceKey string          `json:"baseSourceKey,omitempty"`
	Snapshot      json.RawMessage `json:"snapshot"`
}

// ManifestQuestion is an item of the question bank.
type ManifestQuestion struct {
	SourceKey            string             `json:"sourceKey"`
	ModuleSourceKey      string             `json:"moduleSourceKey"`
	Kind                 string             `json:"kind"`
	Usage                string             `json:"usage"`
	Difficulty           string             `json:"difficulty"`
	Status               string             `json:"status"`
	Title                string             `json:"title"`
	Statement            string             `json:"statement"`
	Hint                 string             `json:"hint,omitempty"`
	Explanation          string             `json:"explanation,omitempty"`
	ScenarioSourceKey    string             `json:"scenarioSourceKey,omitempty"`
	ReferenceSolution    json.RawMessage    `json:"referenceSolution,omitempty"`
	ValidationConditions []domain.Condition `json:"validationConditions,omitempty"`
	Choices              []string           `json:"choices,omitempty"`
	AnswerKey            json.RawMessage    `json:"answerKey,omitempty"`
	Tags                 []string           `json:"tags,omitempty"`
	Position             int                `json:"position"`
}

// ManifestTemplate is an assessment template with its fixed questions.
type ManifestTemplate struct {
	SourceKey       string  `json:"sourceKey"`
	Title           string  `json:"title"`
	Description     string  `json:"description"`
	DurationMinutes int     `json:"durationMinutes"`
	MaxScore        float64 `json:"maxScore"`
	Questions       []struct {
		QuestionSourceKey string  `json:"questionSourceKey"`
		Position          int     `json:"position"`
		Weight            float64 `json:"weight"`
	} `json:"questions"`
}

// ReadManifest decodes a gzip-compressed manifest.
func ReadManifest(r io.Reader) (Manifest, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return Manifest{}, fmt.Errorf("open manifest: %w", err)
	}
	defer gz.Close()
	var m Manifest
	if err := json.NewDecoder(gz).Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	if m.FormatVersion != ManifestFormatVersion {
		return Manifest{}, fmt.Errorf("unsupported manifest format version %d", m.FormatVersion)
	}
	return m, nil
}
