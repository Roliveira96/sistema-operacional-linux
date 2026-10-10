// Package bank loads a list of exercises into the bank of a module (SPEC-023): each one is created in the bank, linked to the
// practice or to the assessment and published, with the dependencies between them resolved by key. It goes through the exercises
// service, so the same rules apply as when a teacher writes them.
package bank

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// Link says where an exercise is linked once loaded.
const (
	LinkPractice   = "practice"
	LinkAssessment = "assessment"
)

// Item is one exercise of the file.
type Item struct {
	// Key names the exercise inside the file, so another one can depend on it.
	Key        string          `json:"key"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	// DependsOn is the key of the exercise whose solution is built first; it has to come earlier in the file.
	DependsOn *string `json:"dependsOn"`
	// Link is "practice" (in the trail) or "assessment" (reserved, exclusive of the assessment).
	Link string `json:"link"`
}

// Service is what the loader needs of the exercises service.
type Service interface {
	List(ctx context.Context, who service.Actor, moduleID uuid.UUID) (service.ExerciseBank, error)
	Create(ctx context.Context, who service.Actor, moduleID uuid.UUID, in domain.ExerciseInput, dependsOn *uuid.UUID, links service.ExerciseLinks) (service.ExerciseRecord, error)
	SetLinks(ctx context.Context, who service.Actor, moduleID, id uuid.UUID, links service.ExerciseLinks, status string) (service.ExerciseRecord, error)
}

// Result counts what a load did.
type Result struct {
	Created int
	// Skipped are the exercises the module already had, by title.
	Skipped int
}

// Parse reads the file: a list of exercises.
func Parse(r io.Reader) ([]Item, error) {
	var items []Item
	if err := json.NewDecoder(r).Decode(&items); err != nil {
		return nil, fmt.Errorf("read exercises: %w", err)
	}
	return items, nil
}

func linksOf(link string) (service.ExerciseLinks, error) {
	switch link {
	case LinkPractice:
		return service.ExerciseLinks{Practice: true}, nil
	case LinkAssessment:
		return service.ExerciseLinks{Assessment: true, Exclusive: true}, nil
	}
	return service.ExerciseLinks{}, fmt.Errorf("link %q must be %q or %q", link, LinkPractice, LinkAssessment)
}

// Load creates, links and publishes the exercises in the order of the file. Running it again does not repeat an exercise the module
// already has with the same title, and a dependency on one of those uses the one that is there.
func Load(ctx context.Context, svc Service, who service.Actor, moduleID uuid.UUID, items []Item) (Result, error) {
	var result Result
	bank, err := svc.List(ctx, who, moduleID)
	if err != nil {
		return result, fmt.Errorf("list the bank: %w", err)
	}
	existing := make(map[string]uuid.UUID, len(bank.Items))
	for _, it := range bank.Items {
		existing[it.Title] = it.ID
	}

	ids := make(map[string]uuid.UUID, len(items))
	for _, it := range items {
		if it.Key == "" {
			return result, fmt.Errorf("exercise %q has no key", it.Title)
		}
		if _, dup := ids[it.Key]; dup {
			return result, fmt.Errorf("key %q is repeated", it.Key)
		}
		links, err := linksOf(it.Link)
		if err != nil {
			return result, fmt.Errorf("exercise %s: %w", it.Key, err)
		}
		var dependsOn *uuid.UUID
		if it.DependsOn != nil {
			id, ok := ids[*it.DependsOn]
			if !ok {
				return result, fmt.Errorf("exercise %s depends on %q, which is not earlier in the file", it.Key, *it.DependsOn)
			}
			dependsOn = &id
		}
		if id, ok := existing[it.Title]; ok {
			ids[it.Key] = id
			result.Skipped++
			continue
		}
		created, err := svc.Create(ctx, who, moduleID, domain.ExerciseInput{
			Title: it.Title, Difficulty: it.Difficulty, Statement: it.Statement,
			Hints: it.Hints, Solution: it.Solution, Conditions: it.Conditions,
		}, dependsOn, service.ExerciseLinks{})
		if err != nil {
			return result, fmt.Errorf("create %s: %w", it.Key, err)
		}
		if _, err := svc.SetLinks(ctx, who, moduleID, created.ID, links, domain.StatusPublished); err != nil {
			return result, fmt.Errorf("publish %s: %w", it.Key, err)
		}
		ids[it.Key] = created.ID
		result.Created++
	}
	return result, nil
}
