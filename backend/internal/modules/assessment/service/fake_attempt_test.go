package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// Grade is a stand-in for the grading of the content module (SPEC-090 RN-04, RN-08): an answer with "invalid" is refused; a single choice and a true
// or false are right when they equal the key; a matching is the share of its links that are in the key; a practical is solved when its machine says
// "solved":true; a written one is pending and kept as sent.
func (f *fakeQuestions) Grade(_ context.Context, kind string, key, answer json.RawMessage) (service.Graded, error) {
	if bytes.Contains(answer, []byte(`"invalid"`)) || !json.Valid(answer) {
		return service.Graded{}, domain.ErrInvalidAnswer
	}
	switch kind {
	case "DISCURSIVE":
		return service.Graded{Pending: true, Stored: answer}, nil
	case "PRACTICAL":
		if bytes.Contains(answer, []byte(`"solved":true`)) {
			return service.Graded{Fraction: 1}, nil
		}
		return service.Graded{}, nil
	case "THEORETICAL_MATCHING":
		var k, a struct {
			Links []struct{ Left, Right string }
		}
		_ = json.Unmarshal(key, &k)
		_ = json.Unmarshal(answer, &a)
		right := 0
		for _, l := range a.Links {
			for _, want := range k.Links {
				if l == want {
					right++
				}
			}
		}
		if len(k.Links) == 0 {
			return service.Graded{}, nil
		}
		return service.Graded{Fraction: float64(right) / float64(len(k.Links))}, nil
	}
	var k, a any
	_ = json.Unmarshal(key, &k)
	_ = json.Unmarshal(answer, &a)
	kb, _ := json.Marshal(k)
	ab, _ := json.Marshal(a)
	if bytes.Equal(kb, ab) {
		return service.Graded{Fraction: 1}, nil
	}
	return service.Graded{}, nil
}

// the attempts of the fake repository (SPEC-090): by assessment and student, and their items by attempt
func (f *fakeRepo) attemptStore() {
	if f.attempts == nil {
		f.attempts = map[[2]uuid.UUID]domain.Attempt{}
		f.attemptItems = map[uuid.UUID][]domain.AttemptItem{}
	}
}

func (f *fakeRepo) CreateAttempt(_ context.Context, a *domain.Attempt, items []domain.AttemptItem) error {
	f.attemptStore()
	key := [2]uuid.UUID{a.AssessmentID, a.StudentID}
	if _, ok := f.attempts[key]; ok {
		return domain.ErrAttemptExists
	}
	a.ID = uuid.New()
	f.attempts[key] = *a
	stored := make([]domain.AttemptItem, len(items))
	for i, it := range items {
		it.AttemptID = a.ID
		stored[i] = it
	}
	f.attemptItems[a.ID] = stored
	return nil
}

func (f *fakeRepo) FindAttempt(_ context.Context, assessmentID, studentID uuid.UUID) (domain.Attempt, error) {
	f.attemptStore()
	a, ok := f.attempts[[2]uuid.UUID{assessmentID, studentID}]
	if !ok {
		return domain.Attempt{}, domain.ErrAttemptNotFound
	}
	return a, nil
}

func (f *fakeRepo) AttemptItems(_ context.Context, attemptID uuid.UUID) ([]domain.AttemptItem, error) {
	f.attemptStore()
	return append([]domain.AttemptItem(nil), f.attemptItems[attemptID]...), nil
}

func (f *fakeRepo) SaveAttemptAnswer(_ context.Context, attemptID uuid.UUID, position int, answer json.RawMessage, at time.Time, solved *bool) error {
	f.attemptStore()
	items := f.attemptItems[attemptID]
	for i := range items {
		if items[i].Position == position {
			items[i].Answer, items[i].AnsweredAt = answer, &at
			if solved != nil {
				items[i].CheckedSolved = solved
			}
			return nil
		}
	}
	return domain.ErrAttemptNotFound
}

func (f *fakeRepo) CloseAttempt(_ context.Context, a *domain.Attempt, points map[int]*domain.Score) error {
	f.attemptStore()
	key := [2]uuid.UUID{a.AssessmentID, a.StudentID}
	if f.attempts[key].Status != domain.AttemptInProgress {
		return domain.ErrAttemptAlreadySubmitted
	}
	f.attempts[key] = *a
	items := f.attemptItems[a.ID]
	for i := range items {
		items[i].Points = points[items[i].Position]
	}
	return nil
}

func (f *fakeRepo) ListAttempts(_ context.Context, assessmentID uuid.UUID) ([]domain.Attempt, error) {
	f.attemptStore()
	var out []domain.Attempt
	for _, a := range f.attempts {
		if a.AssessmentID == assessmentID {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.Before(out[j].StartedAt) })
	return out, nil
}

func (f *fakeRepo) DueAttempts(_ context.Context, before time.Time) ([]domain.Attempt, error) {
	f.attemptStore()
	var out []domain.Attempt
	for _, a := range f.attempts {
		if a.Status == domain.AttemptInProgress && a.DeadlineAt.Before(before) {
			out = append(out, a)
		}
	}
	return out, nil
}

// AnswerKey gives the key as it is for the objective kinds, as the fake bank keeps only the key (SPEC-095 D-02).
func (f *fakeQuestions) AnswerKey(_ context.Context, kind string, key json.RawMessage) (json.RawMessage, error) {
	switch kind {
	case "THEORETICAL_SINGLE", "THEORETICAL_BOOLEAN", "THEORETICAL_MATCHING":
		return key, nil
	}
	return nil, nil
}

// admissions of the fake (SPEC-096): by assessment, the admitted students.
var fakeAdmissions = map[*fakeRepo]map[uuid.UUID]map[uuid.UUID]bool{}

func (f *fakeRepo) Admit(_ context.Context, assessmentID uuid.UUID, students []uuid.UUID, _ time.Time, _ uuid.UUID) ([]uuid.UUID, error) {
	if fakeAdmissions[f] == nil {
		fakeAdmissions[f] = map[uuid.UUID]map[uuid.UUID]bool{}
	}
	if fakeAdmissions[f][assessmentID] == nil {
		fakeAdmissions[f][assessmentID] = map[uuid.UUID]bool{}
	}
	var added []uuid.UUID
	for _, s := range students {
		if !fakeAdmissions[f][assessmentID][s] {
			fakeAdmissions[f][assessmentID][s] = true
			added = append(added, s)
		}
	}
	return added, nil
}

func (f *fakeRepo) Admitted(_ context.Context, assessmentID uuid.UUID) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	for s := range fakeAdmissions[f][assessmentID] {
		out[s] = true
	}
	return out, nil
}

// ExpectedAnswer gives a fixed text for the written kind, as the fake bank keeps only the key (SPEC-097).
func (f *fakeQuestions) ExpectedAnswer(_ context.Context, kind string, _ json.RawMessage) (string, error) {
	if kind == "DISCURSIVE" {
		return "Resposta esperada", nil
	}
	return "", nil
}
