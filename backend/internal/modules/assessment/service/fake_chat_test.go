package service_test

import (
	"context"
	"sort"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// the conversation of the exam of the fake repository (SPEC-093)
var (
	fakeChat       = map[*fakeRepo][]domain.ChatMessage{}
	fakeRecipients = map[*fakeRepo]map[uuid.UUID][]uuid.UUID{} // message -> attempts
)

func (f *fakeRepo) SaveChat(_ context.Context, m *domain.ChatMessage, recipients []uuid.UUID) error {
	m.ID = uuid.New()
	if m.AttemptID != nil {
		for _, a := range f.attempts {
			if a.ID == *m.AttemptID {
				m.StudentID = &a.StudentID
			}
		}
	}
	fakeChat[f] = append(fakeChat[f], *m)
	if fakeRecipients[f] == nil {
		fakeRecipients[f] = map[uuid.UUID][]uuid.UUID{}
	}
	fakeRecipients[f][m.ID] = recipients
	return nil
}

func (f *fakeRepo) received(m domain.ChatMessage, attemptID uuid.UUID) bool {
	if m.AttemptID != nil {
		return *m.AttemptID == attemptID
	}
	for _, a := range fakeRecipients[f][m.ID] {
		if a == attemptID {
			return true
		}
	}
	return false
}

func byTime(list []domain.ChatMessage) []domain.ChatMessage {
	sort.SliceStable(list, func(i, j int) bool { return list[i].CreatedAt.Before(list[j].CreatedAt) })
	return list
}

func (f *fakeRepo) AttemptChat(_ context.Context, attemptID uuid.UUID) ([]domain.ChatMessage, error) {
	var out []domain.ChatMessage
	for _, m := range fakeChat[f] {
		if f.received(m, attemptID) {
			out = append(out, m)
		}
	}
	return byTime(out), nil
}

func (f *fakeRepo) AssessmentChat(_ context.Context, assessmentID uuid.UUID, limit int) ([]domain.ChatMessage, error) {
	var out []domain.ChatMessage
	for _, m := range fakeChat[f] {
		if m.AssessmentID == assessmentID {
			out = append(out, m)
		}
	}
	out = byTime(out)
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

func (f *fakeRepo) ChatCounts(_ context.Context, assessmentID uuid.UUID) (map[uuid.UUID]int, error) {
	out := map[uuid.UUID]int{}
	for _, m := range fakeChat[f] {
		if m.AssessmentID != assessmentID {
			continue
		}
		if m.AttemptID != nil {
			out[*m.AttemptID]++
			continue
		}
		for _, a := range fakeRecipients[f][m.ID] {
			out[a]++
		}
	}
	return out, nil
}
