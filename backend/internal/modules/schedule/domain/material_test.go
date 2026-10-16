package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// ---- SPEC-074: the materials of a lesson ----

func materialInput(title string, kind domain.MaterialKind, visibility domain.MaterialVisibility) domain.MaterialInput {
	return domain.MaterialInput{Title: title, Kind: kind, Visibility: visibility}
}

// Covers SPEC-074 CA-01, CA-02 and RN-01: the title (1 to 120), the kind and the phase must exist, a link is https, and a material has one source.
func TestMaterial_Validate(t *testing.T) {
	session, teacher := uuid.New(), uuid.New()
	good := materialInput("  Lista 1  ", domain.MaterialExercises, domain.VisibilityDuringClass)

	m, err := domain.NewLinkMaterial(session, teacher, good, " https://example.com/lista ")
	require.NoError(t, err)
	assert.Equal(t, "Lista 1", m.Title, "the title is trimmed")
	require.NotNil(t, m.URL)
	assert.Equal(t, "https://example.com/lista", *m.URL)
	assert.Nil(t, m.ObjectKey, "a link has no file")
	assert.Equal(t, session, m.SessionID)
	assert.Equal(t, teacher, m.CreatedBy)
	assert.NotEqual(t, uuid.Nil, m.ID)
	assert.False(t, m.IsFile())

	invalid := []struct {
		name  string
		in    domain.MaterialInput
		url   string
		field string
	}{
		{"empty title", materialInput("   ", domain.MaterialSlides, domain.VisibilityAlways), "https://example.com", "title"},
		{"title of 121", materialInput(strings.Repeat("a", 121), domain.MaterialSlides, domain.VisibilityAlways), "https://example.com", "title"},
		{"unknown kind", materialInput("x", domain.MaterialKind("ANSWER_KEY"), domain.VisibilityAlways), "https://example.com", "kind"},
		{"unknown phase", materialInput("x", domain.MaterialSlides, domain.MaterialVisibility("PRE_CLASS")), "https://example.com", "visibility"},
		{"http link", materialInput("x", domain.MaterialSlides, domain.VisibilityAlways), "http://example.com", "url"},
		{"link without host", materialInput("x", domain.MaterialSlides, domain.VisibilityAlways), "https://", "url"},
		{"link with a space", materialInput("x", domain.MaterialSlides, domain.VisibilityAlways), "https://example.com/a b", "url"},
		{"empty link", materialInput("x", domain.MaterialSlides, domain.VisibilityAlways), "", "url"},
		{"link of 2001", materialInput("x", domain.MaterialSlides, domain.VisibilityAlways), "https://example.com/" + strings.Repeat("a", 1990), "url"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.NewLinkMaterial(session, teacher, tc.in, tc.url)
			require.ErrorIs(t, err, domain.ErrInvalidMaterial)
			var fe *domain.FieldError
			require.ErrorAs(t, err, &fe)
			assert.Equal(t, tc.field, fe.Field)
		})
	}

	// the four kinds and the four phases exist
	for _, k := range []domain.MaterialKind{domain.MaterialSlides, domain.MaterialExercises, domain.MaterialExerciseSolution, domain.MaterialReference} {
		for _, v := range []domain.MaterialVisibility{domain.VisibilityAlways, domain.VisibilityDuringClass, domain.VisibilityAfterClass, domain.VisibilityDuringAndAfter} {
			_, err := domain.NewLinkMaterial(session, teacher, materialInput("x", k, v), "https://example.com")
			assert.NoError(t, err, "%s %s", k, v)
		}
	}
}

func TestMaterial_NewFileMaterial(t *testing.T) {
	session, teacher := uuid.New(), uuid.New()
	file := domain.MaterialFile{ObjectKey: "classes/c/sessions/s/materials/u.pdf", ContentType: "application/pdf", FileName: "Lista 1.pdf", Size: 2048, PageCount: 12}

	m, err := domain.NewFileMaterial(session, teacher, materialInput("Lista 1", domain.MaterialExercises, domain.VisibilityDuringAndAfter), file)
	require.NoError(t, err)
	assert.True(t, m.IsFile())
	assert.Nil(t, m.URL, "a file has no link")
	require.NotNil(t, m.ObjectKey)
	assert.Equal(t, file.ObjectKey, *m.ObjectKey)
	assert.Equal(t, "application/pdf", *m.ContentType)
	assert.EqualValues(t, 2048, *m.SizeBytes)
	assert.Equal(t, "Lista 1.pdf", *m.FileName)
	assert.Equal(t, 12, *m.PageCount)

	image := domain.MaterialFile{ObjectKey: "k.png", ContentType: "image/png", FileName: "quadro.png", Size: 10, PageCount: 1}
	m, err = domain.NewFileMaterial(session, teacher, materialInput("Quadro", domain.MaterialReference, domain.VisibilityAlways), image)
	require.NoError(t, err)
	assert.Equal(t, 1, *m.PageCount)

	_, err = domain.NewFileMaterial(session, teacher, materialInput("", domain.MaterialReference, domain.VisibilityAlways), image)
	assert.ErrorIs(t, err, domain.ErrInvalidMaterial)

	long := image
	long.FileName = strings.Repeat("n", 300)
	m, err = domain.NewFileMaterial(session, teacher, materialInput("x", domain.MaterialReference, domain.VisibilityAlways), long)
	require.NoError(t, err)
	assert.Len(t, []rune(*m.FileName), domain.MaxMaterialFileNameLength, "the name to show is cut, never refused")
}

// lessonOf19 is a lesson on Monday 2026-10-19, from 08:20 to 10:00: its window opens at 08:05 (SPEC-073 D-04).
func lessonOf19() domain.ClassSession {
	return lesson("Permissões", 2026, time.October, 19, hm(8, 20), hm(10, 0))
}

func materialOf(visibility domain.MaterialVisibility) domain.ClassSessionMaterial {
	m, err := domain.NewLinkMaterial(uuid.New(), uuid.New(), materialInput("x", domain.MaterialSlides, visibility), "https://example.com")
	if err != nil {
		panic(err)
	}
	return m
}

// Covers SPEC-074 CA-04, CA-05 and RN-04: what the student sees at each instant, in each phase, at the borders of the window of the lesson, with
// the live room linked to it open or closed, with a release at a time, and in a canceled lesson.
func TestMaterial_VisibleAt(t *testing.T) {
	always, during, after, both := domain.VisibilityAlways, domain.VisibilityDuringClass, domain.VisibilityAfterClass, domain.VisibilityDuringAndAfter
	none := domain.LiveState{}
	open, closed := domain.LiveState{Active: true}, domain.LiveState{Ended: true}
	released := func(h, m int) *time.Time { t := at(2026, time.October, 19, h, m); return &t }

	cases := []struct {
		name     string
		phase    domain.MaterialVisibility
		now      time.Time
		live     domain.LiveState
		release  *time.Time
		canceled bool
		visible  bool
	}{
		// ALWAYS
		{"always, long before", always, at(2026, time.October, 12, 8, 0), none, nil, false, true},
		{"always, after the end", always, at(2026, time.October, 19, 18, 0), none, nil, false, true},
		{"always, in a canceled lesson", always, at(2026, time.October, 19, 9, 0), none, nil, true, true},

		// DURING_CLASS: only while the lesson is under way
		{"during, a minute before the window", during, at(2026, time.October, 19, 8, 4), none, nil, false, false},
		{"during, at the opening of the window", during, at(2026, time.October, 19, 8, 5), none, nil, false, true},
		{"during, a minute before the end", during, at(2026, time.October, 19, 9, 59), none, nil, false, true},
		{"during, at the end", during, at(2026, time.October, 19, 10, 0), none, nil, false, false},
		{"during, past the end with the room still open", during, at(2026, time.October, 19, 10, 30), open, nil, false, true},
		{"during, before the end with the room closed", during, at(2026, time.October, 19, 9, 0), closed, nil, false, false},
		{"during, the day before", during, at(2026, time.October, 18, 9, 0), none, nil, false, false},
		{"during, with the room open before the window", during, at(2026, time.October, 19, 7, 0), open, nil, false, true},
		{"during, in a canceled lesson", during, at(2026, time.October, 19, 9, 0), none, nil, true, false},

		// AFTER_CLASS: only once the lesson is over
		{"after, a minute before the end", after, at(2026, time.October, 19, 9, 59), none, nil, false, false},
		{"after, at the end", after, at(2026, time.October, 19, 10, 0), none, nil, false, true},
		{"after, the next day", after, at(2026, time.October, 20, 9, 0), none, nil, false, true},
		{"after, with the room closed before the end", after, at(2026, time.October, 19, 9, 0), closed, nil, false, true},
		{"after, past the end with the room still open", after, at(2026, time.October, 19, 10, 30), open, nil, false, false},
		{"after, the day before", after, at(2026, time.October, 18, 9, 0), none, nil, false, false},
		{"after, in a canceled lesson", after, at(2026, time.October, 20, 9, 0), none, nil, true, false},

		// DURING_AND_AFTER: from the window on, and it does not hide again
		{"both, a minute before the window", both, at(2026, time.October, 19, 8, 4), none, nil, false, false},
		{"both, at the opening of the window", both, at(2026, time.October, 19, 8, 5), none, nil, false, true},
		{"both, after the end", both, at(2026, time.October, 19, 10, 30), none, nil, false, true},
		{"both, the next day", both, at(2026, time.October, 20, 9, 0), none, nil, false, true},
		{"both, room closed", both, at(2026, time.October, 19, 9, 0), closed, nil, false, true},
		{"both, in a canceled lesson", both, at(2026, time.October, 19, 9, 0), none, nil, true, false},

		// the release at a time makes it visible, from then on, in any phase
		{"after, a minute before its release", after, at(2026, time.October, 19, 8, 59), none, released(9, 0), false, false},
		{"after, at its release", after, at(2026, time.October, 19, 9, 0), none, released(9, 0), false, true},
		{"during, released after the lesson", during, at(2026, time.October, 19, 12, 0), none, released(12, 0), false, true},
		{"both, released before the window", both, at(2026, time.October, 19, 7, 0), none, released(7, 0), false, true},
		{"after, in a canceled lesson, released", after, at(2026, time.October, 19, 9, 0), none, released(9, 0), true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			session := lessonOf19()
			if tc.canceled {
				session.Status = domain.SessionCanceled
			}
			m := materialOf(tc.phase)
			m.ReleaseAt = tc.release
			assert.Equal(t, tc.visible, m.VisibleAt(session, tc.live, tc.now))
			_, hidden := m.HiddenUntil(session, tc.live, tc.now)
			assert.Equal(t, !tc.visible, hidden, "it is hidden exactly when it is not visible")
		})
	}
}

// Covers SPEC-074 CA-06 and RN-05: what the teacher is told about a hidden material.
func TestMaterial_HiddenUntil(t *testing.T) {
	release := at(2026, time.October, 19, 9, 0)
	cases := []struct {
		name     string
		phase    domain.MaterialVisibility
		now      time.Time
		live     domain.LiveState
		release  *time.Time
		canceled bool
		reason   domain.HiddenReason
		when     *time.Time
	}{
		{"during, before the window", domain.VisibilityDuringClass, at(2026, time.October, 19, 8, 0), domain.LiveState{}, nil, false, domain.HiddenUntilClassStart, nil},
		{"both, before the window", domain.VisibilityDuringAndAfter, at(2026, time.October, 18, 8, 0), domain.LiveState{}, nil, false, domain.HiddenUntilClassStart, nil},
		{"after, before the end", domain.VisibilityAfterClass, at(2026, time.October, 19, 8, 0), domain.LiveState{}, nil, false, domain.HiddenUntilClassEnd, nil},
		{"after, the room still open past the end", domain.VisibilityAfterClass, at(2026, time.October, 19, 10, 30), domain.LiveState{Active: true}, nil, false, domain.HiddenUntilClassEnd, nil},
		{"during, the lesson is over", domain.VisibilityDuringClass, at(2026, time.October, 19, 10, 0), domain.LiveState{}, nil, false, domain.HiddenUntilClassOver, nil},
		{"during, the room was closed", domain.VisibilityDuringClass, at(2026, time.October, 19, 9, 0), domain.LiveState{Ended: true}, nil, false, domain.HiddenUntilClassOver, nil},
		{"after, a release before the end of the lesson", domain.VisibilityAfterClass, at(2026, time.October, 19, 8, 0), domain.LiveState{}, &release, false, domain.HiddenUntilRelease, &release},
		{"after, a release after the end of the lesson", domain.VisibilityAfterClass, at(2026, time.October, 18, 8, 0), domain.LiveState{}, atPtr(at(2026, time.October, 25, 9, 0)), false, domain.HiddenUntilClassEnd, nil},
		{"during, over, with a release in the future", domain.VisibilityDuringClass, at(2026, time.October, 19, 10, 30), domain.LiveState{}, atPtr(at(2026, time.October, 25, 9, 0)), false, domain.HiddenUntilRelease, atPtr(at(2026, time.October, 25, 9, 0))},
		{"canceled", domain.VisibilityAfterClass, at(2026, time.October, 19, 8, 0), domain.LiveState{}, nil, true, domain.HiddenUntilClassCanceled, nil},
		{"canceled, with a release in the future", domain.VisibilityDuringClass, at(2026, time.October, 19, 8, 0), domain.LiveState{}, &release, true, domain.HiddenUntilRelease, &release},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			session := lessonOf19()
			if tc.canceled {
				session.Status = domain.SessionCanceled
			}
			m := materialOf(tc.phase)
			m.ReleaseAt = tc.release
			got, hidden := m.HiddenUntil(session, tc.live, tc.now)
			require.True(t, hidden)
			assert.Equal(t, tc.reason, got.Reason)
			if tc.when == nil {
				assert.Nil(t, got.At)
			} else {
				require.NotNil(t, got.At)
				assert.True(t, tc.when.Equal(*got.At))
			}
		})
	}

	// a material that is visible has nothing to wait for
	_, hidden := materialOf(domain.VisibilityAlways).HiddenUntil(lessonOf19(), domain.LiveState{}, at(2026, time.October, 19, 8, 0))
	assert.False(t, hidden)
}

func atPtr(t time.Time) *time.Time { return &t }
