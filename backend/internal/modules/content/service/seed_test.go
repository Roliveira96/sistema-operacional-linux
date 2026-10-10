package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ───── fakes ─────

type fakeModules struct {
	byKey    map[string]uuid.UUID
	edited   map[string]bool
	links    map[uuid.UUID][]uuid.UUID
	failWith error
}

func newFakeModules() *fakeModules {
	return &fakeModules{byKey: map[string]uuid.UUID{}, edited: map[string]bool{}, links: map[uuid.UUID][]uuid.UUID{}}
}

func (f *fakeModules) UpsertModule(_ context.Context, in cmservice.SeedModuleInput) (uuid.UUID, cmservice.SeedOutcome, error) {
	if f.failWith != nil {
		return uuid.Nil, "", f.failWith
	}
	if id, ok := f.byKey[in.SourceKey]; ok {
		if f.edited[in.SourceKey] {
			return id, cmservice.SeedPreserved, nil
		}
		return id, cmservice.SeedUpdated, nil
	}
	id := uuid.New()
	f.byKey[in.SourceKey] = id
	return id, cmservice.SeedInserted, nil
}

func (f *fakeModules) EnsureExercise(_ context.Context, moduleID, questionID uuid.UUID) (bool, error) {
	for _, q := range f.links[moduleID] {
		if q == questionID {
			return false, nil
		}
	}
	f.links[moduleID] = append(f.links[moduleID], questionID)
	return true, nil
}

type fakeUsers struct{ admin *userdomain.User }

func (f fakeUsers) FindByEmail(context.Context, string) (userdomain.User, error) {
	if f.admin == nil {
		return userdomain.User{}, userdomain.ErrNotFound
	}
	return *f.admin, nil
}

type fakeStore struct {
	blocks    map[string]domain.ContentBlock
	scenarios map[string]domain.Scenario
	questions map[string]domain.Question
	templates map[string]domain.AssessmentTemplate
	items     map[uuid.UUID][]domain.TemplateQuestion
	failSave  error
	published []uuid.UUID
	noChanges bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		blocks: map[string]domain.ContentBlock{}, scenarios: map[string]domain.Scenario{},
		questions: map[string]domain.Question{}, templates: map[string]domain.AssessmentTemplate{},
		items: map[uuid.UUID][]domain.TemplateQuestion{},
	}
}

func find[T any](m map[string]T, key string) (T, error) {
	v, ok := m[key]
	if !ok {
		var zero T
		return zero, ErrNotFound
	}
	return v, nil
}

func (f *fakeStore) FindBlockBySourceKey(_ context.Context, k string) (domain.ContentBlock, error) {
	return find(f.blocks, k)
}
func (f *fakeStore) SaveBlock(_ context.Context, b *domain.ContentBlock) error {
	f.blocks[*b.SourceKey] = *b
	return f.failSave
}
func (f *fakeStore) HasEditedBlocks(_ context.Context, moduleID uuid.UUID) (bool, error) {
	for _, b := range f.blocks {
		if b.ModuleID == moduleID && b.EditedByTeacherAt != nil {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeStore) PublishVersion(_ context.Context, moduleID, _ uuid.UUID, _ string) (domain.ModuleVersion, error) {
	if f.noChanges {
		return domain.ModuleVersion{}, ErrNoChanges
	}
	f.published = append(f.published, moduleID)
	return domain.ModuleVersion{}, nil
}
func (f *fakeStore) FindScenarioBySourceKey(_ context.Context, k string) (domain.Scenario, error) {
	return find(f.scenarios, k)
}
func (f *fakeStore) SaveScenario(_ context.Context, s *domain.Scenario) error {
	f.scenarios[*s.SourceKey] = *s
	return nil
}
func (f *fakeStore) FindQuestionBySourceKey(_ context.Context, k string) (domain.Question, error) {
	return find(f.questions, k)
}
func (f *fakeStore) SaveQuestion(_ context.Context, q *domain.Question) error {
	f.questions[*q.SourceKey] = *q
	return nil
}
func (f *fakeStore) FindTemplateBySourceKey(_ context.Context, k string) (domain.AssessmentTemplate, error) {
	return find(f.templates, k)
}
func (f *fakeStore) SaveTemplate(_ context.Context, t *domain.AssessmentTemplate) error {
	f.templates[*t.SourceKey] = *t
	return nil
}
func (f *fakeStore) ReplaceTemplateQuestions(_ context.Context, id uuid.UUID, items []domain.TemplateQuestion) error {
	f.items[id] = items
	return nil
}

type passTx struct{}

func (passTx) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	return fn(ctx)
}

// ───── manifest builder ─────

const snapshot = `{"formato":"exame-so/maquina","versao":1,"hostname":"h","contas":{"usuarios":[],"grupos":[]},"raiz":{"nome":"","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","modificadoEm":"x","filhos":[]}}`

func testManifest() Manifest {
	practical := ManifestQuestion{
		SourceKey: "dir-1", ModuleSourceKey: "diretorios", Kind: domain.KindPractical, Usage: domain.UsageExercise,
		Difficulty: "EASY", Status: domain.StatusPublished, Title: "Crie", Statement: `<p onclick="x()">Crie <b>/a</b></p>`,
		Hint: "use mkdir", ScenarioSourceKey: "scenario/question/dir-1", ReferenceSolution: json.RawMessage(`[{"command":"mkdir /a","terminal":1}]`),
		ValidationConditions: []domain.Condition{{Type: domain.CondDirectoryExists, Path: "/a"}},
	}
	quiz := ManifestQuestion{
		SourceKey: "quiz-1", ModuleSourceKey: "simulado", Kind: domain.KindTheoreticalSingle, Usage: domain.UsageAssessment,
		Difficulty: "MEDIUM", Status: domain.StatusPublished, Title: "Q", Statement: "Qual?", Explanation: "Porque",
		Choices: []string{"a", "<script>x</script>b"}, AnswerKey: json.RawMessage(`{"correct":1}`), Tags: []string{"LPI"},
	}
	tpl := ManifestTemplate{SourceKey: "simulado/quiz", Title: "Quiz", Description: "d", DurationMinutes: 30, MaxScore: 10}
	tpl.Questions = append(tpl.Questions, struct {
		QuestionSourceKey string  `json:"questionSourceKey"`
		Position          int     `json:"position"`
		Weight            float64 `json:"weight"`
	}{"quiz-1", 1, 1})
	return Manifest{
		FormatVersion: 1, ContentHash: "h",
		Modules: []ManifestModule{
			{SourceKey: "diretorios", Title: "Diretórios", Description: "d", Icon: "📁", Color: "--cor-dir", DisplayOrder: 3, Visibility: "PUBLIC",
				Blocks: []ManifestBlock{
					{SourceKey: "diretorios/concepts", Type: domain.BlockLegacyHTML, Payload: json.RawMessage(`{"html":"<p>ok</p><script>alert(1)</script>"}`)},
					{SourceKey: "diretorios/demo", Type: domain.BlockCommand, Payload: json.RawMessage(`{"steps":[{"command":"ls","terminal":1}]}`)},
				}},
			{SourceKey: "simulado", Title: "Simulados", Description: "d", Icon: "📝", Color: "--cor-sim", DisplayOrder: 9, Visibility: "AUTHENTICATED"},
		},
		Scenarios: []ManifestScenario{
			{SourceKey: "scenario/question/dir-1", BaseSourceKey: "scenario/topic/diretorios", Snapshot: json.RawMessage(snapshot)},
			{SourceKey: "scenario/topic/diretorios", Snapshot: json.RawMessage(snapshot)},
		},
		Questions:           []ManifestQuestion{practical, quiz},
		AssessmentTemplates: []ManifestTemplate{tpl},
	}
}

type harness struct {
	seeder  *Seeder
	modules *fakeModules
	store   *fakeStore
}

func newHarness(admin bool) *harness {
	h := &harness{modules: newFakeModules(), store: newFakeStore()}
	users := fakeUsers{}
	if admin {
		users.admin = &userdomain.User{Model: database.Model{ID: uuid.New()}}
	}
	h.seeder = NewSeeder(h.modules, users, h.store, passTx{}, zap.NewNop())
	return h
}

// ───── tests ─────

// Covers SPEC-011 CA-05 and CA-11 (service side).
func TestSeedInsertsEverything(t *testing.T) {
	h := newHarness(true)
	r, err := h.seeder.Run(context.Background(), testManifest(), "admin@rmo.dev.br")
	require.NoError(t, err)

	assert.Equal(t, Report{
		Modules: Counts{Inserted: 2}, Blocks: Counts{Inserted: 2}, Scenarios: Counts{Inserted: 2},
		Questions: Counts{Inserted: 2}, Templates: Counts{Inserted: 1}, ExercisesLinked: 1,
	}, r)
	derived := h.store.scenarios["scenario/question/dir-1"]
	base := h.store.scenarios["scenario/topic/diretorios"]
	require.NotNil(t, derived.BaseScenarioID)
	assert.Equal(t, base.ID, *derived.BaseScenarioID, "derived scenarios point to their base")
	assert.Equal(t, 2, h.store.blocks["diretorios/demo"].Position)
	q := h.store.questions["dir-1"]
	assert.Equal(t, derived.ID, *q.ScenarioID)
	assert.JSONEq(t, `[{"type":"DIRECTORY_EXISTS","path":"/a"}]`, string(q.ValidationConditions))
	assert.Len(t, h.store.items[h.store.templates["simulado/quiz"].ID], 1)
	assert.Len(t, h.modules.links[h.modules.byKey["diretorios"]], 1, "only EXERCISE questions join the module path")
}

// Covers SPEC-011 CA-10 (service side).
func TestSeedSanitizesHTML(t *testing.T) {
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	assert.NotContains(t, string(h.store.blocks["diretorios/concepts"].Payload), "script")
	assert.NotContains(t, h.store.questions["dir-1"].Statement, "onclick")
	assert.NotContains(t, string(h.store.questions["quiz-1"].Choices), "script")
	assert.Equal(t, "use mkdir", *h.store.questions["dir-1"].Hint)
	assert.Nil(t, h.store.questions["quiz-1"].Hint)
}

// Covers SPEC-011 CA-06 and CA-07 (service side).
func TestSeedIsIdempotentAndPreservesTeacherEdits(t *testing.T) {
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)

	edited := time.Now()
	q := h.store.questions["dir-1"]
	q.Title = "Teacher title"
	q.EditedByTeacherAt = &edited
	h.store.questions["dir-1"] = q
	b := h.store.blocks["diretorios/demo"]
	b.EditedByTeacherAt = &edited
	h.store.blocks["diretorios/demo"] = b
	tpl := h.store.templates["simulado/quiz"]
	tpl.DeletedAt = gorm.DeletedAt{Time: edited, Valid: true}
	h.store.templates["simulado/quiz"] = tpl
	h.modules.edited["simulado"] = true

	r, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	assert.Equal(t, Counts{Updated: 1, Preserved: 1}, r.Modules)
	// One edited block freezes the module: neither it nor its siblings are touched (RN-04a).
	assert.Equal(t, Counts{Preserved: 2}, r.Blocks)
	assert.Equal(t, Counts{Updated: 2}, r.Scenarios)
	assert.Equal(t, Counts{Updated: 1, Preserved: 1}, r.Questions)
	assert.Equal(t, Counts{Preserved: 1}, r.Templates)
	assert.Zero(t, r.ExercisesLinked, "existing links are not duplicated")
	assert.Equal(t, "Teacher title", h.store.questions["dir-1"].Title)
}

// Covers SPEC-011 CA-09.
func TestSeedRequiresTheAdminAccount(t *testing.T) {
	_, err := newHarness(false).seeder.Run(context.Background(), testManifest(), "admin@rmo.dev.br")
	assert.ErrorIs(t, err, ErrAdminMissing)
}

func TestSeedRejectsInconsistentManifests(t *testing.T) {
	cases := map[string]func(m *Manifest){
		"unknown block type":     func(m *Manifest) { m.Modules[0].Blocks[0].Type = "VIDEO" },
		"invalid block payload":  func(m *Manifest) { m.Modules[0].Blocks[0].Payload = json.RawMessage(`[1]`) },
		"invalid snapshot":       func(m *Manifest) { m.Scenarios[1].Snapshot = json.RawMessage(`{}`) },
		"unknown base":           func(m *Manifest) { m.Scenarios[0].BaseSourceKey = "nope" },
		"unknown module":         func(m *Manifest) { m.Questions[0].ModuleSourceKey = "nope" },
		"unknown scenario":       func(m *Manifest) { m.Questions[0].ScenarioSourceKey = "nope" },
		"invalid conditions":     func(m *Manifest) { m.Questions[0].ValidationConditions = nil },
		"unknown template entry": func(m *Manifest) { m.AssessmentTemplates[0].Questions[0].QuestionSourceKey = "nope" },
		"invalid visibility":     func(m *Manifest) { m.Modules[0].Visibility = "SECRET" },
	}
	for name, mutate := range cases {
		m := testManifest()
		mutate(&m)
		h := newHarness(true)
		h.modules.failWith = nil
		if name == "invalid visibility" {
			h.modules.failWith = errors.New("invalid module visibility")
		}
		_, err := h.seeder.Run(context.Background(), m, "a")
		assert.Error(t, err, name)
	}

	draft := testManifest()
	draft.Questions[0].Status = domain.StatusDraft
	draft.Questions[0].ValidationConditions = nil
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), draft, "a")
	require.NoError(t, err, "a draft may lack conditions")
	assert.JSONEq(t, `[]`, string(h.store.questions["dir-1"].ValidationConditions))

	h = newHarness(true)
	h.store.failSave = errors.New("disk full")
	_, err = h.seeder.Run(context.Background(), testManifest(), "a")
	assert.ErrorContains(t, err, "disk full")
}

func TestReadManifest(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	require.NoError(t, json.NewEncoder(gz).Encode(testManifest()))
	require.NoError(t, gz.Close())
	m, err := ReadManifest(&buf)
	require.NoError(t, err)
	assert.Len(t, m.Questions, 2)

	_, err = ReadManifest(bytes.NewReader([]byte("plain")))
	assert.Error(t, err)

	buf.Reset()
	gz = gzip.NewWriter(&buf)
	_, _ = gz.Write([]byte(`{"formatVersion":2}`))
	_ = gz.Close()
	_, err = ReadManifest(&buf)
	assert.ErrorContains(t, err, "unsupported manifest format")

	buf.Reset()
	gz = gzip.NewWriter(&buf)
	_, _ = gz.Write([]byte(`not json`))
	_ = gz.Close()
	_, err = ReadManifest(&buf)
	assert.ErrorContains(t, err, "decode manifest")
}
