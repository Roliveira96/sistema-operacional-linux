package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// Covers SPEC-075 RN-04: another module reads a lesson by its id, whatever the class, with no actor to authorize; that module checks the class
// and decides who may do what with it.
func TestLesson_ReadsALessonByIdForAnotherModule(t *testing.T) {
	f := newFixture(t)
	sessions := f.setup(t)
	require.NotEmpty(t, sessions)

	got, err := f.svc.Lesson(context.Background(), sessions[0].ID)
	require.NoError(t, err)
	assert.Equal(t, sessions[0].ID, got.ID)
	assert.Equal(t, f.class.ID, got.ClassID)
	assert.Equal(t, sessions[0].StartTime, got.StartTime)
	assert.Equal(t, sessions[0].EndTime, got.EndTime)

	_, err = f.svc.Lesson(context.Background(), uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}
