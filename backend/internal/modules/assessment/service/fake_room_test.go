package service_test

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// the commands and the requests for help of the fake repository (SPEC-091)
var (
	fakeCommands = map[*fakeRepo][]domain.AttemptCommand{}
	fakeHelps    = map[*fakeRepo][]domain.HelpRequest{}
)

func (f *fakeRepo) FindAttemptByID(_ context.Context, id uuid.UUID) (domain.Attempt, error) {
	f.attemptStore()
	for _, a := range f.attempts {
		if a.ID == id {
			return a, nil
		}
	}
	return domain.Attempt{}, domain.ErrAttemptNotFound
}

func (f *fakeRepo) SaveCommand(_ context.Context, c *domain.AttemptCommand) error {
	c.ID = uuid.New()
	fakeCommands[f] = append(fakeCommands[f], *c)
	return nil
}

func (f *fakeRepo) Commands(_ context.Context, attemptID uuid.UUID) ([]domain.AttemptCommand, error) {
	var out []domain.AttemptCommand
	for _, c := range fakeCommands[f] {
		if c.AttemptID == attemptID {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ExecutedAt.Before(out[j].ExecutedAt) })
	return out, nil
}

func (f *fakeRepo) CreateHelp(_ context.Context, h *domain.HelpRequest) error {
	h.ID = uuid.New()
	fakeHelps[f] = append(fakeHelps[f], *h)
	return nil
}

func (f *fakeRepo) LatestHelp(_ context.Context, attemptID uuid.UUID) (*domain.HelpRequest, error) {
	var last *domain.HelpRequest
	for i := range fakeHelps[f] {
		if h := fakeHelps[f][i]; h.AttemptID == attemptID {
			last = &h
		}
	}
	return last, nil
}

func (f *fakeRepo) FindHelp(_ context.Context, id uuid.UUID) (domain.HelpRequest, error) {
	for _, h := range fakeHelps[f] {
		if h.ID == id {
			return h, nil
		}
	}
	return domain.HelpRequest{}, domain.ErrHelpNotFound
}

func (f *fakeRepo) CloseHelp(_ context.Context, id uuid.UUID, status domain.HelpStatus, at time.Time, by *uuid.UUID, answer string) error {
	for i := range fakeHelps[f] {
		if h := &fakeHelps[f][i]; h.ID == id && h.Status == domain.HelpOpen {
			h.Status, h.ClosedAt, h.ClosedBy, h.Answer = status, &at, by, answer
			return nil
		}
	}
	return domain.ErrHelpNotFound
}

func (f *fakeRepo) OpenHelps(_ context.Context, assessmentID uuid.UUID) ([]domain.HelpRequest, error) {
	var out []domain.HelpRequest
	for _, h := range fakeHelps[f] {
		if h.AssessmentID == assessmentID && h.Status == domain.HelpOpen {
			out = append(out, h)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

// AttemptHelps gives every request of an attempt, the oldest first (SPEC-097).
func (f *fakeRepo) AttemptHelps(_ context.Context, attemptID uuid.UUID) ([]domain.HelpRequest, error) {
	var out []domain.HelpRequest
	for _, h := range fakeHelps[f] {
		if h.AttemptID == attemptID {
			out = append(out, h)
		}
	}
	return out, nil
}
