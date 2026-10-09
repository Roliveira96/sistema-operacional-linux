package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Environment errors (SPEC-020).
var (
	// ErrInvalidSnapshot means the machine sent to be recorded is not a serialized machine.
	ErrInvalidSnapshot = errors.New("the environment is not a valid serialized machine")
	// ErrSnapshotTooLarge means the machine is over the size limit.
	ErrSnapshotTooLarge = errors.New("the environment is too large")
	// ErrEnvironmentNotFound means no stored environment has that id.
	ErrEnvironmentNotFound = errors.New("environment not found")
)

// CreateEnvironment records the machine an author prepared and returns its id (RN-01).
func (a *Author) CreateEnvironment(ctx context.Context, who Actor, moduleID uuid.UUID, snapshot json.RawMessage) (uuid.UUID, error) {
	if err := a.authorize(ctx, moduleID, who); err != nil {
		return uuid.Nil, err
	}
	if len(snapshot) > domain.MaxSnapshotBytes {
		return uuid.Nil, ErrSnapshotTooLarge
	}
	if err := domain.ValidateSnapshot(snapshot); err != nil {
		return uuid.Nil, ErrInvalidSnapshot
	}
	now := a.now()
	sc := domain.Scenario{ID: uuid.New(), Snapshot: snapshot, FormatVersion: domain.MachineVersion, CreatedAt: now, UpdatedAt: now}
	if err := a.store.SaveScenario(ctx, &sc); err != nil {
		return uuid.Nil, err
	}
	a.audit("record-environment", who, moduleID, nil)
	return sc.ID, nil
}

// Environment returns a recorded machine, so an author can go on from where another card stopped (RN-05).
func (a *Author) Environment(ctx context.Context, scenarioID uuid.UUID) (json.RawMessage, error) {
	sc, err := a.store.FindScenario(ctx, scenarioID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrEnvironmentNotFound
	}
	if err != nil {
		return nil, err
	}
	return sc.Snapshot, nil
}

// environmentRef reads the scenario id a card header points to, if it has one.
func environmentRef(payload json.RawMessage) (uuid.UUID, bool) {
	var p struct {
		Environment *struct {
			ScenarioID string `json:"scenarioId"`
		} `json:"environment"`
	}
	if json.Unmarshal(payload, &p) != nil || p.Environment == nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(p.Environment.ScenarioID)
	return id, err == nil
}

// checkEnvironments makes sure every environment a saved card points to exists (RN-02).
func (a *Author) checkEnvironments(ctx context.Context, entries []ReplaceCardEntry) error {
	var problems []domain.FieldError
	for i, e := range entries {
		id, ok := environmentRef(e.Payload)
		if !ok {
			continue
		}
		if _, err := a.store.FindScenario(ctx, id); errors.Is(err, ErrNotFound) {
			problems = append(problems, domain.FieldError{Field: fmt.Sprintf("blocks[%d].environment.scenarioId", i), Reason: "unknown environment"})
		} else if err != nil {
			return err
		}
	}
	if len(problems) > 0 {
		return &domain.PayloadError{Fields: problems}
	}
	return nil
}
