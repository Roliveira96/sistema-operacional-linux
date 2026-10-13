package domain_test

import (
	"errors"
	"strings"
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

// Covers SPEC-041 RN-01: the summary is trimmed and holds up to 300 characters, counted in runes.
func TestNormalizeSummary(t *testing.T) {
	got, err := domain.NormalizeSummary("  Disciplina prática de Linux.  ")
	if err != nil || got != "Disciplina prática de Linux." {
		t.Fatalf("expected trimmed summary, got %q, %v", got, err)
	}
	if got, err := domain.NormalizeSummary(""); err != nil || got != "" {
		t.Fatalf("expected empty summary to be valid, got %q, %v", got, err)
	}
	if _, err := domain.NormalizeSummary(strings.Repeat("ç", domain.SummaryMaxLength)); err != nil {
		t.Fatalf("expected 300 runes to be valid, got %v", err)
	}
	if _, err := domain.NormalizeSummary(strings.Repeat("a", domain.SummaryMaxLength+1)); !errors.Is(err, domain.ErrSummaryTooLong) {
		t.Fatalf("expected ErrSummaryTooLong, got %v", err)
	}
}

// Covers SPEC-042 RN-12.
func TestNormalizeColor(t *testing.T) {
	for _, c := range domain.ClassColors {
		if got, err := domain.NormalizeColor(" " + c + " "); err != nil || got != c {
			t.Fatalf("expected %q to be valid, got %q, %v", c, got, err)
		}
	}
	if got, err := domain.NormalizeColor(""); err != nil || got != domain.DefaultClassColor {
		t.Fatalf("expected the default color, got %q, %v", got, err)
	}
	if _, err := domain.NormalizeColor("black"); !errors.Is(err, domain.ErrInvalidColor) {
		t.Fatalf("expected ErrInvalidColor, got %v", err)
	}
}

// Covers SPEC-041 RN-02: the error of a long formatted field tells which field and matches ErrContentTooLong.
func TestContentTooLongError(t *testing.T) {
	err := error(&domain.ContentTooLongError{Field: "syllabus"})
	if !errors.Is(err, domain.ErrContentTooLong) || !strings.HasPrefix(err.Error(), "syllabus: ") {
		t.Fatalf("unexpected error %v", err)
	}
	if errors.Is(err, domain.ErrSummaryTooLong) {
		t.Fatal("it must not match another error")
	}
}
