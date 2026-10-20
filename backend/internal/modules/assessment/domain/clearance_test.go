package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-076 CA-01, CA-02 (RN-01): an exam is in person and an assignment is online unless said otherwise, and an assignment can only be
// online.
func TestModality_DefaultsByTypeAndAssignmentIsOnlyOnline(t *testing.T) {
	assert.Equal(t, domain.ModalityInPerson, domain.DefaultModality(domain.TypeExam))
	assert.Equal(t, domain.ModalityOnline, domain.DefaultModality(domain.TypeAssignment))

	exam := valid()
	for _, m := range []domain.Modality{domain.ModalityInPerson, domain.ModalityOnline} {
		exam.Modality = m
		assert.NoError(t, exam.Validate(), "an exam may be "+string(m))
	}

	assignment := valid()
	assignment.Type = domain.TypeAssignment
	assignment.Modality = domain.ModalityOnline
	assert.NoError(t, assignment.Validate())
	assignment.Modality = domain.ModalityInPerson
	assert.ErrorIs(t, assignment.Validate(), domain.ErrInvalidAssessment, "an assignment cannot be in person")

	for _, bad := range []domain.Modality{"", "HYBRID", "in_person"} {
		a := valid()
		a.Modality = bad
		assert.ErrorIs(t, a.Validate(), domain.ErrInvalidAssessment, "modality %q", bad)
	}
}

// Covers SPEC-076 CA-03 (RN-02): only an in-person assessment may require the clearance, and it does by default; an online one never does.
func TestRequiresClearance_OnlyInPersonAndDefaultsOn(t *testing.T) {
	assert.True(t, domain.DefaultRequiresClearance(domain.ModalityInPerson))
	assert.False(t, domain.DefaultRequiresClearance(domain.ModalityOnline))

	a := valid()
	a.Modality, a.RequiresClearance = domain.ModalityInPerson, true
	assert.NoError(t, a.Validate())
	a.RequiresClearance = false
	assert.NoError(t, a.Validate(), "the teacher may turn it off for an in-person exam")

	a.Modality, a.RequiresClearance = domain.ModalityOnline, false
	assert.NoError(t, a.Validate())
	a.RequiresClearance = true
	assert.ErrorIs(t, a.Validate(), domain.ErrInvalidAssessment, "an online assessment cannot require it")
}

// Covers SPEC-076 CA-07, CA-08 (RN-06): the reason of a refusal is optional, trimmed, plain and at most 300 characters; an approval has none;
// "waiting" is derived and is never a decision.
func TestClearance_ValidatesStatusAndReason(t *testing.T) {
	reason, err := domain.CleanClearanceReason(domain.ClearanceRejected, "  Reprovado por faltas  ")
	require.NoError(t, err)
	require.NotNil(t, reason)
	assert.Equal(t, "Reprovado por faltas", *reason)

	for _, blank := range []string{"", "   ", "\n"} {
		reason, err = domain.CleanClearanceReason(domain.ClearanceRejected, blank)
		assert.NoError(t, err)
		assert.Nil(t, reason, "a blank reason is stored empty")
	}

	_, err = domain.CleanClearanceReason(domain.ClearanceRejected, strings.Repeat("ç", 300))
	assert.NoError(t, err, "300 characters of two bytes each")
	_, err = domain.CleanClearanceReason(domain.ClearanceRejected, strings.Repeat("ç", 301))
	assert.ErrorIs(t, err, domain.ErrInvalidClearance)

	reason, err = domain.CleanClearanceReason(domain.ClearanceApproved, "")
	assert.NoError(t, err)
	assert.Nil(t, reason)
	_, err = domain.CleanClearanceReason(domain.ClearanceApproved, "motivo")
	assert.ErrorIs(t, err, domain.ErrInvalidClearance, "an approval takes no reason")

	for _, status := range []domain.ClearanceStatus{domain.ClearancePending, "MAYBE", ""} {
		_, err = domain.CleanClearanceReason(status, "")
		assert.ErrorIs(t, err, domain.ErrInvalidClearance, "status %q cannot be decided", status)
	}
}

// Covers SPEC-076 RN-08, RN-11: the new access result and the new kind of event exist, and the errors are the ones of section 5.
func TestClearance_NamesOfTheNewValues(t *testing.T) {
	assert.Equal(t, "NOT_CLEARED", string(domain.AccessNotCleared))
	assert.Equal(t, "CLEARANCE_UPDATED", string(domain.EventClearanceUpdated))
	assert.Equal(t, "PENDING", string(domain.ClearancePending))
	assert.Equal(t, "APPROVED", string(domain.ClearanceApproved))
	assert.Equal(t, "REJECTED", string(domain.ClearanceRejected))
	for _, err := range []error{domain.ErrInvalidClearance, domain.ErrClearanceNotRequired, domain.ErrClearanceLocked} {
		assert.Error(t, err)
	}
}
