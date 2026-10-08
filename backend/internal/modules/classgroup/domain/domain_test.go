package domain_test

import (
	"testing"
	"time"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
)

func TestValidateDates(t *testing.T) {
	now := time.Now()
	if err := domain.ValidateDates(now, now.Add(24*time.Hour)); err != nil {
		t.Fatalf("expected valid date range, got: %v", err)
	}

	if err := domain.ValidateDates(now, now); err != nil {
		t.Fatalf("expected equal dates to be valid, got: %v", err)
	}

	if err := domain.ValidateDates(now.Add(24*time.Hour), now); err != domain.ErrInvalidDateRange {
		t.Fatalf("expected ErrInvalidDateRange, got: %v", err)
	}
}

func TestValidateInviteLink(t *testing.T) {
	now := time.Now()
	later := now.Add(2*time.Hour)

	// Disabled: valid regardless of dates
	if err := domain.ValidateInviteLink(false, nil, nil); err != nil {
		t.Fatalf("expected valid when disabled, got: %v", err)
	}

	// Enabled with missing dates: error
	if err := domain.ValidateInviteLink(true, nil, nil); err != domain.ErrInviteLinkConfigRequired {
		t.Fatalf("expected ErrInviteLinkConfigRequired, got: %v", err)
	}

	// Enabled with valid dates: ok
	if err := domain.ValidateInviteLink(true, &now, &later); err != nil {
		t.Fatalf("expected valid invite dates, got: %v", err)
	}

	// Enabled with reversed dates: error
	if err := domain.ValidateInviteLink(true, &later, &now); err != domain.ErrInvalidInviteRange {
		t.Fatalf("expected ErrInvalidInviteRange, got: %v", err)
	}
}

func TestIsExpiringSoon(t *testing.T) {
	now := time.Now()

	class := &domain.ClassGroup{
		Status:  domain.ClassStatusActive,
		EndDate: now.Add(10 * 24 * time.Hour), // 10 days left
	}
	if !class.IsExpiringSoon(now) {
		t.Fatalf("expected class to be expiring soon (10 days <= 15 days)")
	}

	classFar := &domain.ClassGroup{
		Status:  domain.ClassStatusActive,
		EndDate: now.Add(20 * 24 * time.Hour), // 20 days left
	}
	if classFar.IsExpiringSoon(now) {
		t.Fatalf("expected class not expiring soon (20 days > 15 days)")
	}

	classPast := &domain.ClassGroup{
		Status:  domain.ClassStatusActive,
		EndDate: now.Add(-1 * time.Hour),
	}
	if classPast.IsExpiringSoon(now) {
		t.Fatalf("expected class already past not to be expiring soon")
	}

	classArchived := &domain.ClassGroup{
		Status:  domain.ClassStatusArchived,
		EndDate: now.Add(5 * 24 * time.Hour),
	}
	if classArchived.IsExpiringSoon(now) {
		t.Fatalf("archived class should not report expiring soon")
	}
}

func TestIsInviteLinkValid(t *testing.T) {
	now := time.Now()
	start := now.Add(-1 * time.Hour)
	end := now.Add(1 * time.Hour)
	token := "abc123token"

	class := &domain.ClassGroup{
		Status:           domain.ClassStatusActive,
		EnableInviteLink: true,
		InviteLinkToken:  &token,
		InviteLinkStart:  &start,
		InviteLinkEnd:    &end,
	}

	if !class.IsInviteLinkValid(now) {
		t.Fatalf("expected invite link to be valid")
	}

	// Before start
	if class.IsInviteLinkValid(now.Add(-2 * time.Hour)) {
		t.Fatalf("invite link should not be valid before start")
	}

	// After end
	if class.IsInviteLinkValid(now.Add(2 * time.Hour)) {
		t.Fatalf("invite link should not be valid after end")
	}

	// Disabled
	class.EnableInviteLink = false
	if class.IsInviteLinkValid(now) {
		t.Fatalf("disabled invite link should not be valid")
	}

	// Archived class
	class.EnableInviteLink = true
	class.Status = domain.ClassStatusArchived
	if class.IsInviteLinkValid(now) {
		t.Fatalf("invite link of archived class should not be valid")
	}
}

func TestGenerateInviteToken(t *testing.T) {
	tok1, err := domain.GenerateInviteToken()
	if err != nil {
		t.Fatalf("generate token error: %v", err)
	}
	tok2, err := domain.GenerateInviteToken()
	if err != nil {
		t.Fatalf("generate token error: %v", err)
	}
	if tok1 == "" || tok2 == "" {
		t.Fatalf("tokens must not be empty")
	}
	if tok1 == tok2 {
		t.Fatalf("tokens should be unique, got duplicate: %s", tok1)
	}
}
