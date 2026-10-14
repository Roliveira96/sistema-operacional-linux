package domain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
)

func archivedAt(t time.Time) domain.ClassGroup {
	return domain.ClassGroup{Status: domain.ClassStatusArchived, ArchivedAt: &t}
}

// Covers SPEC-050 RN-01: a class can be deleted 30 days after it was archived, not before.
func TestCanDeleteAfterThirtyDays(t *testing.T) {
	archived := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	c := archivedAt(archived)

	after := c.DeletableAfter()
	require.NotNil(t, after)
	assert.Equal(t, time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC), *after)
	assert.Equal(t, 30, domain.ArchiveRetentionDays)

	assert.False(t, c.CanDelete(archived.Add(29*24*time.Hour)), "29 days is too soon")
	assert.False(t, c.CanDelete(archived.Add(30*24*time.Hour-time.Second)))
	assert.True(t, c.CanDelete(archived.Add(30*24*time.Hour)), "exactly 30 days is allowed")
	assert.True(t, c.CanDelete(archived.Add(31*24*time.Hour)))
}

// Covers SPEC-050 RN-01: only an archived class, with the date of the archiving, can be deleted.
func TestCannotDeleteWhatIsNotArchived(t *testing.T) {
	long := time.Now().Add(-100 * 24 * time.Hour)
	for _, status := range []domain.ClassStatus{domain.ClassStatusActive, domain.ClassStatusDraft} {
		c := domain.ClassGroup{Status: status, ArchivedAt: &long}
		assert.Nil(t, c.DeletableAfter(), string(status))
		assert.False(t, c.CanDelete(time.Now()), string(status))
	}
	noDate := domain.ClassGroup{Status: domain.ClassStatusArchived}
	assert.Nil(t, noDate.DeletableAfter(), "an archived class without the date")
	assert.False(t, noDate.CanDelete(time.Now()))
}

// Covers SPEC-050 RN-04: the refusal carries the date from which the class can be deleted.
func TestNotDeletableError(t *testing.T) {
	when := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	err := error(&domain.NotDeletableError{After: &when})
	assert.ErrorIs(t, err, domain.ErrClassNotDeletable)
	var nd *domain.NotDeletableError
	require.True(t, errors.As(err, &nd))
	assert.Equal(t, when, *nd.After)
	assert.NotEmpty(t, err.Error())
}
