package bank

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

type created struct {
	in        domain.ExerciseInput
	dependsOn *uuid.UUID
	links     service.ExerciseLinks
	status    string
	id        uuid.UUID
}

type fakeService struct {
	existing  []service.ExerciseRecord
	created   []*created
	createErr error
	linkErr   error
}

func (f *fakeService) List(context.Context, service.Actor, uuid.UUID) (service.ExerciseBank, error) {
	return service.ExerciseBank{Items: f.existing}, nil
}

func (f *fakeService) Create(_ context.Context, _ service.Actor, _ uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, links service.ExerciseLinks) (service.ExerciseRecord, error) {
	if f.createErr != nil {
		return service.ExerciseRecord{}, f.createErr
	}
	c := &created{in: in, dependsOn: dependsOn, links: links, id: uuid.New()}
	f.created = append(f.created, c)
	r := service.ExerciseRecord{}
	r.ID = c.id
	return r, nil
}

func (f *fakeService) SetLinks(_ context.Context, _ service.Actor, _, id uuid.UUID, links service.ExerciseLinks, status string) (service.ExerciseRecord, error) {
	if f.linkErr != nil {
		return service.ExerciseRecord{}, f.linkErr
	}
	for _, c := range f.created {
		if c.id == id {
			c.links, c.status = links, status
		}
	}
	return service.ExerciseRecord{}, nil
}

func str(s string) *string { return &s }

const file = `[
  {"key":"a1","title":"Criar a pasta","difficulty":"EASY","statement":"<p>x</p>","hints":[{"text":"d"}],"solution":{"steps":[{"command":"mkdir /a"}]},"conditions":[{"kind":"DIR_EXISTS","path":"/a"}],"dependsOn":null,"link":"practice"},
  {"key":"a2","title":"Criar o script","difficulty":"MEDIUM","statement":"<p>y</p>","hints":[],"solution":null,"conditions":[],"dependsOn":"a1","link":"practice"},
  {"key":"p1","title":"Da prova","difficulty":"HARD","statement":"<p>z</p>","hints":[],"solution":null,"conditions":[],"dependsOn":null,"link":"assessment"}
]`

// Covers SPEC-023 11.1 and 12.3: the exercises go to the bank, linked and published, and a dependency points to the one created before.
func TestLoadCreatesLinksAndPublishesWithDependencies(t *testing.T) {
	items, err := Parse(strings.NewReader(file))
	if err != nil || len(items) != 3 {
		t.Fatalf("Parse() = %d items, %v", len(items), err)
	}
	f := &fakeService{}
	res, err := Load(context.Background(), f, service.Actor{Role: "TEACHER"}, uuid.New(), items)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if res.Created != 3 || res.Skipped != 0 {
		t.Fatalf("result = %+v", res)
	}
	if f.created[0].dependsOn != nil || f.created[1].dependsOn == nil || *f.created[1].dependsOn != f.created[0].id {
		t.Errorf("dependencies = %v / %v", f.created[0].dependsOn, f.created[1].dependsOn)
	}
	for i, c := range f.created {
		if c.status != domain.StatusPublished {
			t.Errorf("exercise %d status = %q", i, c.status)
		}
	}
	if !f.created[0].links.Practice || f.created[0].links.Assessment {
		t.Errorf("practice links = %+v", f.created[0].links)
	}
	if got := f.created[2].links; got.Practice || !got.Assessment || !got.Exclusive {
		t.Errorf("assessment links = %+v", got)
	}
	if string(f.created[0].in.Conditions) != `[{"kind":"DIR_EXISTS","path":"/a"}]` || f.created[0].in.Title != "Criar a pasta" {
		t.Errorf("input = %+v", f.created[0].in)
	}
}

// Running it twice does not repeat an exercise, and a dependency on one that is already there uses it.
func TestLoadSkipsWhatTheModuleAlreadyHas(t *testing.T) {
	items, _ := Parse(strings.NewReader(file))
	have := service.ExerciseRecord{}
	have.ID, have.Title = uuid.New(), "Criar a pasta"
	f := &fakeService{existing: []service.ExerciseRecord{have}}
	res, err := Load(context.Background(), f, service.Actor{}, uuid.New(), items)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if res.Created != 2 || res.Skipped != 1 {
		t.Fatalf("result = %+v", res)
	}
	if f.created[0].dependsOn == nil || *f.created[0].dependsOn != have.ID {
		t.Errorf("the dependency should point to the exercise already there, got %v", f.created[0].dependsOn)
	}
}

func TestLoadRejectsAFileThatDoesNotHoldTogether(t *testing.T) {
	cases := map[string][]Item{
		"depends on a later one": {{Key: "b", Title: "B", Link: LinkPractice, DependsOn: str("a")}, {Key: "a", Title: "A", Link: LinkPractice}},
		"unknown link":           {{Key: "a", Title: "A", Link: "elsewhere"}},
		"no key":                 {{Title: "A", Link: LinkPractice}},
		"repeated key":           {{Key: "a", Title: "A", Link: LinkPractice}, {Key: "a", Title: "B", Link: LinkPractice}},
	}
	for name, items := range cases {
		if _, err := Load(context.Background(), &fakeService{}, service.Actor{}, uuid.New(), items); err == nil {
			t.Errorf("%s: Load() error = nil", name)
		}
	}
}

func TestLoadStopsAtTheFirstErrorOfTheService(t *testing.T) {
	items, _ := Parse(strings.NewReader(file))
	boom := errors.New("boom")
	if _, err := Load(context.Background(), &fakeService{createErr: boom}, service.Actor{}, uuid.New(), items); !errors.Is(err, boom) {
		t.Errorf("create error = %v", err)
	}
	if _, err := Load(context.Background(), &fakeService{linkErr: boom}, service.Actor{}, uuid.New(), items); !errors.Is(err, boom) {
		t.Errorf("link error = %v", err)
	}
}

func TestParseRejectsInvalidJSON(t *testing.T) {
	if _, err := Parse(strings.NewReader("{")); err == nil {
		t.Error("Parse() error = nil")
	}
}

// The file of História do Linux (50 exercises, 23 of them depending on another) holds together and passes the rules of the server.
func TestSeedFileOfHistoriaDoLinuxIsValid(t *testing.T) {
	f, err := os.Open("../../../../../seeds/historia-do-linux-exercicios.json")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer f.Close()
	items, err := Parse(f)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(items) != 50 {
		t.Fatalf("exercises = %d, want 50", len(items))
	}
	san := domain.NewHTMLSanitizer()
	seen := map[string]bool{}
	titles := map[string]bool{}
	deps, assessment := 0, 0
	for _, it := range items {
		if _, err := linksOf(it.Link); err != nil {
			t.Errorf("%s: %v", it.Key, err)
		}
		if _, err := domain.NormalizeExercise(domain.ExerciseInput{Title: it.Title, Difficulty: it.Difficulty, Statement: it.Statement, Hints: it.Hints, Solution: it.Solution, Conditions: it.Conditions}, san); err != nil {
			t.Errorf("%s: %v", it.Key, err)
		}
		if it.DependsOn != nil {
			deps++
			if !seen[*it.DependsOn] {
				t.Errorf("%s depends on %q, which is not earlier", it.Key, *it.DependsOn)
			}
		}
		if it.Link == LinkAssessment {
			assessment++
		}
		if seen[it.Key] || titles[it.Title] {
			t.Errorf("%s: repeated key or title", it.Key)
		}
		seen[it.Key], titles[it.Title] = true, true
	}
	if deps != 23 || assessment != 5 {
		t.Errorf("dependencies = %d, assessment = %d; want 23 and 5", deps, assessment)
	}
}
