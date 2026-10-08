package domain_test

import (
	"testing"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
)

func TestNormalizeAcademicID(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "7 digits without prefix", input: "1234567", want: "1234567"},
		{name: "with lowercase 'a' prefix", input: "a1234567", want: "1234567"},
		{name: "with uppercase 'A' prefix", input: "A1234567", want: "1234567"},
		{name: "with spaces", input: "  a1234567  ", want: "1234567"},
		{name: "too short", input: "123456", wantErr: true},
		{name: "too long", input: "12345678", wantErr: true},
		{name: "non-digits", input: "a123456b", wantErr: true},
		{name: "empty", input: "", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := domain.NormalizeAcademicID(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("NormalizeAcademicID(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("NormalizeAcademicID(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestNormalizeEmail(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "valid standard email", input: "student@alunos.utfpr.edu.br", want: "student@alunos.utfpr.edu.br"},
		{name: "uppercase email", input: "STUDENT@GMAIL.COM", want: "student@gmail.com"},
		{name: "with leading and trailing spaces", input: "  user@domain.com  ", want: "user@domain.com"},
		{name: "missing at sign", input: "student.domain.com", wantErr: true},
		{name: "missing domain dot", input: "student@domain", wantErr: true},
		{name: "spaces in middle", input: "stud ent@domain.com", wantErr: true},
		{name: "empty", input: "", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := domain.NormalizeEmail(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("NormalizeEmail(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
			}
			if got != tc.want {
				t.Fatalf("NormalizeEmail(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestStudentProfile_TableName(t *testing.T) {
	var profile domain.StudentProfile
	if profile.TableName() != "student_profiles" {
		t.Fatalf("expected student_profiles, got %s", profile.TableName())
	}
}
