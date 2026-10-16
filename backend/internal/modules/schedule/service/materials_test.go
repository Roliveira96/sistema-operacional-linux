package service_test

import (
	"bytes"
	"context"
	"io"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- SPEC-074: the materials of a lesson ----

// The persistence of the materials in the fake repository.

func (f *fakeRepo) ListMaterials(_ context.Context, sessionIDs []uuid.UUID) (map[uuid.UUID][]domain.ClassSessionMaterial, error) {
	out := map[uuid.UUID][]domain.ClassSessionMaterial{}
	for _, m := range f.materials {
		if contains(sessionIDs, m.SessionID) {
			out[m.SessionID] = append(out[m.SessionID], m)
		}
	}
	for _, list := range out {
		sort.Slice(list, func(i, j int) bool { return list[i].Position < list[j].Position })
	}
	return out, nil
}

func (f *fakeRepo) FindMaterial(_ context.Context, id uuid.UUID) (domain.ClassSessionMaterial, error) {
	m, ok := f.materials[id]
	if !ok {
		return domain.ClassSessionMaterial{}, domain.ErrMaterialNotFound
	}
	return m, nil
}

func (f *fakeRepo) CreateMaterial(_ context.Context, m *domain.ClassSessionMaterial) error {
	f.materials[m.ID] = *m
	return nil
}

func (f *fakeRepo) SaveMaterials(_ context.Context, list []domain.ClassSessionMaterial) error {
	for _, m := range list {
		f.materials[m.ID] = m
	}
	return nil
}

func (f *fakeRepo) DeleteMaterial(_ context.Context, id uuid.UUID) error {
	delete(f.materials, id)
	return nil
}

func (f *fakeRepo) SetHasContent(_ context.Context, sessionID uuid.UUID, has bool) error {
	s := f.sessions[sessionID]
	s.HasContent = has
	f.sessions[sessionID] = s
	return nil
}

// fakeMaterialStore is the bucket: it keeps what was put and signs addresses of 15 minutes.
type fakeMaterialStore struct {
	puts  []string
	body  map[string][]byte
	types map[string]string
	err   error
}

func (s *fakeMaterialStore) PutObject(_ context.Context, key string, r io.Reader, _ int64, contentType string) error {
	if s.err != nil {
		return s.err
	}
	data, _ := io.ReadAll(r)
	s.puts = append(s.puts, key)
	s.body[key], s.types[key] = data, contentType
	return nil
}

func (s *fakeMaterialStore) PresignedGetURL(_ context.Context, key string, ttl time.Duration) (string, error) {
	return "https://files.example/" + key + "?ttl=" + strings.TrimSuffix(ttl.String(), "m0s") + "m", nil
}

// fakeMaterialFiles is the validation of the files by their first bytes, like the one of the presentations of the live classroom.
type fakeMaterialFiles struct{ calls int }

func (f *fakeMaterialFiles) Classify(pageCount int, size int64, header []byte) (service.ClassifiedFile, error) {
	f.calls++
	switch {
	case bytes.HasPrefix(header, []byte("%PDF-")):
		if size > 25<<20 {
			return service.ClassifiedFile{}, domain.ErrMaterialFileTooLarge
		}
		if pageCount < 1 || pageCount > 100 {
			return service.ClassifiedFile{}, &domain.FieldError{Field: "pageCount", Err: domain.ErrInvalidMaterialFile}
		}
		return service.ClassifiedFile{ContentType: "application/pdf", Extension: ".pdf", PageCount: pageCount}, nil
	case bytes.HasPrefix(header, []byte("\x89PNG")):
		if size > 10<<20 {
			return service.ClassifiedFile{}, domain.ErrMaterialFileTooLarge
		}
		return service.ClassifiedFile{ContentType: "image/png", Extension: ".png", PageCount: 1}, nil
	}
	return service.ClassifiedFile{}, &domain.FieldError{Field: "file", Err: domain.ErrInvalidMaterialFile}
}

type materialFixture struct {
	*timelineFixture
	store *fakeMaterialStore
	files *fakeMaterialFiles
	// lesson is the lesson of Monday 2026-10-19, from 08:20 to 10:00: the window opens at 08:05
	lesson domain.ClassSession
}

func newMaterialFixture(t *testing.T) *materialFixture {
	t.Helper()
	f := &materialFixture{timelineFixture: newTimelineFixture(t), store: &fakeMaterialStore{body: map[string][]byte{}, types: map[string]string{}}, files: &fakeMaterialFiles{}}
	f.svc.WithMaterials(f.files, f.store)
	f.lesson = f.on(t, day(2026, 10, 19))
	return f
}

func pdf() []byte { return []byte("%PDF-1.7\n%âãÏÓ\n1 0 obj\n") }

func (f *materialFixture) addFile(t *testing.T, actor service.Actor, title string, kind domain.MaterialKind, visibility domain.MaterialVisibility) service.MaterialView {
	t.Helper()
	view, err := f.svc.AddFileMaterial(context.Background(), actor, f.class.ID, f.lesson.ID, service.FileMaterialInput{
		MaterialInput: domain.MaterialInput{Title: title, Kind: kind, Visibility: visibility}, FileName: title + ".pdf", PageCount: 5, Size: int64(len(pdf())), File: bytes.NewReader(pdf()),
	})
	require.NoError(t, err)
	return view
}

func (f *materialFixture) addLink(t *testing.T, title string, kind domain.MaterialKind, visibility domain.MaterialVisibility) service.MaterialView {
	t.Helper()
	view, err := f.svc.AddLinkMaterial(context.Background(), f.teacher, f.class.ID, f.lesson.ID, service.LinkMaterialInput{
		MaterialInput: domain.MaterialInput{Title: title, Kind: kind, Visibility: visibility}, URL: "https://example.com/" + strings.ReplaceAll(title, " ", "-"),
	})
	require.NoError(t, err)
	return view
}

// fourPhases puts one material of each phase on the lesson of the 19th.
func (f *materialFixture) fourPhases(t *testing.T) (always, during, after, both service.MaterialView) {
	t.Helper()
	always = f.addLink(t, "Roteiro", domain.MaterialSlides, domain.VisibilityAlways)
	during = f.addLink(t, "Lista", domain.MaterialExercises, domain.VisibilityDuringClass)
	after = f.addLink(t, "Resolucao", domain.MaterialExerciseSolution, domain.VisibilityAfterClass)
	both = f.addLink(t, "Apoio", domain.MaterialReference, domain.VisibilityDuringAndAfter)
	return
}

func titles(list []service.MaterialView) []string {
	out := make([]string, len(list))
	for i, m := range list {
		out[i] = m.Title
	}
	return out
}

// Covers SPEC-074 CA-01, CA-07 and RN-02: the file is checked by its first bytes, goes to the bucket under a key the server makes (never
// from the name of the file), and becomes the last material of the lesson.
func TestAddFileMaterial_ClassifiesAndStoresWithGeneratedKey(t *testing.T) {
	f := newMaterialFixture(t)

	first := f.addFile(t, f.teacher, "Slides da aula", domain.MaterialSlides, domain.VisibilityAlways)
	assert.Equal(t, "Slides da aula", first.Title)
	assert.Equal(t, 0, first.Position)
	assert.True(t, first.IsFile())
	assert.Equal(t, "application/pdf", *first.ContentType)
	assert.Equal(t, 5, *first.PageCount)
	assert.EqualValues(t, len(pdf()), *first.SizeBytes)
	assert.Equal(t, "Slides da aula.pdf", *first.FileName)
	assert.Equal(t, f.teacher.UserID, first.CreatedBy)

	prefix := "classes/" + f.class.ID.String() + "/sessions/" + f.lesson.ID.String() + "/materials/"
	require.NotNil(t, first.ObjectKey)
	assert.True(t, strings.HasPrefix(*first.ObjectKey, prefix), *first.ObjectKey)
	assert.True(t, strings.HasSuffix(*first.ObjectKey, ".pdf"))
	assert.NotContains(t, *first.ObjectKey, "Slides", "the key has nothing of the name of the file")
	assert.Equal(t, pdf(), f.store.body[*first.ObjectKey], "the whole file was stored")
	assert.Equal(t, "application/pdf", f.store.types[*first.ObjectKey])

	second := f.addFile(t, f.teacher, "Outra", domain.MaterialReference, domain.VisibilityAfterClass)
	assert.Equal(t, 1, second.Position, "the last position")
	assert.NotEqual(t, *first.ObjectKey, *second.ObjectKey)
	assert.Len(t, f.repo.materials, 2)

	// an administrator sends to the lesson of any class
	_ = f.addFile(t, f.admin, "Do admin", domain.MaterialReference, domain.VisibilityAlways)
}

// Covers SPEC-074 CA-01: a file that is not a PDF or an image, a file too big, a bad title or phase and a lesson with 50 materials store
// nothing.
func TestAddFileMaterial_RejectsFormatSizeAndLimit(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	send := func(in service.FileMaterialInput) error {
		_, err := f.svc.AddFileMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, in)
		return err
	}
	good := func() service.FileMaterialInput {
		return service.FileMaterialInput{MaterialInput: domain.MaterialInput{Title: "x", Kind: domain.MaterialSlides, Visibility: domain.VisibilityAlways},
			FileName: "x.pdf", PageCount: 3, Size: 100, File: bytes.NewReader(pdf())}
	}

	notAPDF := good()
	notAPDF.File = strings.NewReader("GIF89a not a pdf")
	err := send(notAPDF)
	require.ErrorIs(t, err, domain.ErrInvalidMaterialFile)
	assert.Equal(t, "file", contentField(err))

	noPages := good()
	noPages.PageCount = 0
	err = send(noPages)
	require.ErrorIs(t, err, domain.ErrInvalidMaterialFile)
	assert.Equal(t, "pageCount", contentField(err))

	big := good()
	big.Size = 26 << 20
	assert.ErrorIs(t, send(big), domain.ErrMaterialFileTooLarge)

	noTitle := good()
	noTitle.Title = " "
	err = send(noTitle)
	require.ErrorIs(t, err, domain.ErrInvalidMaterial)
	assert.Equal(t, "title", contentField(err))

	badPhase := good()
	badPhase.Visibility = "PRE_CLASS"
	err = send(badPhase)
	require.ErrorIs(t, err, domain.ErrInvalidMaterial)
	assert.Equal(t, "visibility", contentField(err))

	assert.Empty(t, f.store.puts, "nothing stored for the refused ones")
	assert.Empty(t, f.repo.materials)

	for i := 0; i < domain.MaxMaterialsPerSession; i++ {
		f.addLink(t, "Link", domain.MaterialReference, domain.VisibilityAlways)
	}
	assert.Equal(t, 50, domain.MaxMaterialsPerSession)
	assert.ErrorIs(t, send(good()), domain.ErrMaterialLimitExceeded, "the 51st")
	_, err = f.svc.AddLinkMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, service.LinkMaterialInput{
		MaterialInput: domain.MaterialInput{Title: "x", Kind: domain.MaterialReference, Visibility: domain.VisibilityAlways}, URL: "https://example.com"})
	assert.ErrorIs(t, err, domain.ErrMaterialLimitExceeded, "a link too")
	assert.Empty(t, f.store.puts, "nothing stored for the 51st")

	delete(f.repo.materials, firstID(f.repo.materials))
	f.store.err = io.ErrClosedPipe
	assert.ErrorIs(t, send(good()), io.ErrClosedPipe, "a failure of the bucket is not hidden")
	assert.Len(t, f.repo.materials, 49, "and no material is left without its file")
}

func firstID(m map[uuid.UUID]domain.ClassSessionMaterial) uuid.UUID {
	for id := range m {
		return id
	}
	return uuid.Nil
}

// Covers SPEC-074 CA-02: a link is kept; a link that is not https, a bad title, kind or phase are refused with the field.
func TestAddLinkMaterial(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	view := f.addLink(t, "Documentação", domain.MaterialReference, domain.VisibilityDuringAndAfter)
	assert.False(t, view.IsFile())
	assert.Equal(t, "https://example.com/Documentação", *view.URL)
	assert.Equal(t, domain.VisibilityDuringAndAfter, view.Visibility)

	cases := []struct {
		name  string
		in    service.LinkMaterialInput
		field string
	}{
		{"http", service.LinkMaterialInput{MaterialInput: domain.MaterialInput{Title: "x", Kind: domain.MaterialSlides, Visibility: domain.VisibilityAlways}, URL: "http://a.com"}, "url"},
		{"title", service.LinkMaterialInput{MaterialInput: domain.MaterialInput{Title: "", Kind: domain.MaterialSlides, Visibility: domain.VisibilityAlways}, URL: "https://a.com"}, "title"},
		{"kind", service.LinkMaterialInput{MaterialInput: domain.MaterialInput{Title: "x", Kind: "VIDEO", Visibility: domain.VisibilityAlways}, URL: "https://a.com"}, "kind"},
		{"phase", service.LinkMaterialInput{MaterialInput: domain.MaterialInput{Title: "x", Kind: domain.MaterialSlides, Visibility: "NEVER"}, URL: "https://a.com"}, "visibility"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := f.svc.AddLinkMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, tc.in)
			require.ErrorIs(t, err, domain.ErrInvalidMaterial)
			assert.Equal(t, tc.field, contentField(err))
		})
	}
	assert.Len(t, f.repo.materials, 1)
}

// Covers SPEC-074 CA-03 and RN-03: editing the fields of a material, or its position (the others take their places), changes only that
// material and never its source.
func TestUpdateMaterial_ReordersAndKeepsSource(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	a := f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	b := f.addFile(t, f.teacher, "B", domain.MaterialExercises, domain.VisibilityDuringClass)
	c := f.addLink(t, "C", domain.MaterialReference, domain.VisibilityAlways)

	order := func() []string {
		list, err := f.svc.Materials(ctx, f.teacher, f.class.ID, f.lesson.ID)
		require.NoError(t, err)
		positions := make([]int, len(list))
		for i, m := range list {
			positions[i] = m.Position
		}
		assert.Equal(t, []int{0, 1, 2}, positions, "the positions stay 0, 1, 2")
		return titles(list)
	}
	assert.Equal(t, []string{"A", "B", "C"}, order())

	zero := 0
	got, err := f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, c.ID, service.MaterialChange{Position: &zero})
	require.NoError(t, err)
	assert.Equal(t, 0, got.Position)
	assert.Equal(t, []string{"C", "A", "B"}, order())

	last := 99
	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, c.ID, service.MaterialChange{Position: &last})
	require.NoError(t, err)
	assert.Equal(t, []string{"A", "B", "C"}, order(), "a position past the end is the last")

	title, kind, phase := "Lista de exercícios", domain.MaterialExerciseSolution, domain.VisibilityAfterClass
	release := at(2026, time.October, 19, 11, 0)
	got, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, b.ID, service.MaterialChange{Title: &title, Kind: &kind, Visibility: &phase, SetReleaseAt: true, ReleaseAt: &release})
	require.NoError(t, err)
	assert.Equal(t, title, got.Title)
	assert.Equal(t, kind, got.Kind)
	assert.Equal(t, phase, got.Visibility)
	require.NotNil(t, got.ReleaseAt)
	assert.True(t, release.Equal(*got.ReleaseAt))
	assert.Equal(t, *b.ObjectKey, *got.ObjectKey, "the file is the same")
	assert.Equal(t, "A", f.repo.materials[a.ID].Title, "the others are untouched")

	got, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, b.ID, service.MaterialChange{SetReleaseAt: true})
	require.NoError(t, err)
	assert.Nil(t, got.ReleaseAt, "a null release clears it")

	got, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, b.ID, service.MaterialChange{})
	require.NoError(t, err)
	assert.Equal(t, title, got.Title, "an empty change changes nothing")

	bad := " "
	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, a.ID, service.MaterialChange{Title: &bad})
	require.ErrorIs(t, err, domain.ErrInvalidMaterial)
	assert.Equal(t, "title", contentField(err))
	wrongKind := domain.MaterialKind("X")
	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, a.ID, service.MaterialChange{Kind: &wrongKind})
	assert.ErrorIs(t, err, domain.ErrInvalidMaterial)
	negative := -1
	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, a.ID, service.MaterialChange{Position: &negative})
	assert.ErrorIs(t, err, domain.ErrInvalidMaterial)

	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, uuid.New(), service.MaterialChange{Title: &title})
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound)
	other := f.on(t, day(2026, 10, 21))
	_, err = f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, other.ID, a.ID, service.MaterialChange{Title: &title})
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "the material of another lesson is not found through this one")
}

// Covers SPEC-074 CA-03, RN-06: the exclusion is logical, the others close the gap, and the lesson that has no more content says so.
func TestDeleteMaterial_Logical(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	a := f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	b := f.addFile(t, f.teacher, "B", domain.MaterialExercises, domain.VisibilityAlways)
	c := f.addLink(t, "C", domain.MaterialReference, domain.VisibilityAlways)
	puts := len(f.store.puts)

	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, b.ID))
	list, err := f.svc.Materials(ctx, f.teacher, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"A", "C"}, titles(list))
	assert.Equal(t, []int{0, 1}, []int{list[0].Position, list[1].Position}, "the gap is closed")
	assert.Len(t, f.store.body, puts, "the object stays in the bucket")
	assert.ErrorIs(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, b.ID), domain.ErrMaterialNotFound)

	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent)
	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, a.ID))
	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent, "one is left")
	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, c.ID))
	assert.False(t, f.repo.sessions[f.lesson.ID].HasContent, "nothing is left")
}

// Covers SPEC-074 CA-03 and RN-03: sending, changing and removing materials is not changing the lesson: no change mark, no reason, no e-mail.
func TestMaterials_NoOverrideNoMail(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	before := f.repo.sessions[f.lesson.ID]
	require.False(t, before.Overridden)

	m := f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	title := "B"
	_, err := f.svc.UpdateMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, m.ID, service.MaterialChange{Title: &title})
	require.NoError(t, err)
	_, err = f.svc.ReleaseMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, f.addLink(t, "C", domain.MaterialExerciseSolution, domain.VisibilityAfterClass).ID)
	require.NoError(t, err)
	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, m.ID))

	after := f.repo.sessions[f.lesson.ID]
	assert.False(t, after.Overridden)
	assert.Nil(t, after.ChangeReason)
	assert.Equal(t, before.Status, after.Status)
	assert.Equal(t, before.StartTime, after.StartTime)
	assert.Empty(t, f.repo.outbox, "no e-mail")
}

// Covers SPEC-074 CA-04 and RN-04: the student gets only what is visible at the now of the server, and nothing of the rest, not even a
// count.
func TestListMaterials_StudentSeesOnlyVisible(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	f.fourPhases(t)
	seen := func(now time.Time) []string {
		f.now = now
		list, err := f.svc.Materials(ctx, f.student, f.class.ID, f.lesson.ID)
		require.NoError(t, err)
		return titles(list)
	}

	assert.Equal(t, []string{"Roteiro"}, seen(at(2026, time.October, 19, 8, 4)), "a minute before the window")
	assert.Equal(t, []string{"Roteiro", "Lista", "Apoio"}, seen(at(2026, time.October, 19, 8, 5)), "the window opened")
	assert.Equal(t, []string{"Roteiro", "Lista", "Apoio"}, seen(at(2026, time.October, 19, 9, 59)))
	assert.Equal(t, []string{"Roteiro", "Resolucao", "Apoio"}, seen(at(2026, time.October, 19, 10, 0)), "the lesson is over")
	assert.Equal(t, []string{"Roteiro", "Resolucao", "Apoio"}, seen(at(2026, time.October, 20, 9, 0)), "the next day")

	// the room linked to the lesson rules over the clock (RN-04)
	f.now = at(2026, time.October, 19, 10, 30)
	f.live.linked[f.lesson.ID] = []service.LiveSummary{{ID: uuid.New(), Status: "ACTIVE"}}
	assert.Equal(t, []string{"Roteiro", "Lista", "Apoio"}, seen(f.now), "still under way: the room is open past the hour")
	ended := at(2026, time.October, 19, 9, 0)
	f.live.linked[f.lesson.ID] = []service.LiveSummary{{ID: uuid.New(), Status: "FINISHED", EndedAt: &ended}}
	assert.Equal(t, []string{"Roteiro", "Resolucao", "Apoio"}, seen(at(2026, time.October, 19, 9, 30)), "the room was closed before the hour")

	// a student gets no flag of the hidden ones: what he gets is visible
	list, err := f.svc.Materials(ctx, f.student, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	for _, m := range list {
		assert.True(t, m.VisibleNow)
		assert.Nil(t, m.HiddenUntil)
	}

	// a canceled lesson shows only what is always visible
	canceled := f.repo.sessions[f.lesson.ID]
	canceled.Status = domain.SessionCanceled
	f.repo.sessions[canceled.ID] = canceled
	f.live.linked = map[uuid.UUID][]service.LiveSummary{}
	assert.Equal(t, []string{"Roteiro"}, seen(at(2026, time.October, 20, 9, 0)))
}

// Covers SPEC-074 CA-06 and RN-05: the teacher and the administrator read them all, each one with whether it is visible and, if not, until
// when.
func TestListMaterials_TeacherSeesHiddenUntil(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	f.fourPhases(t)
	f.now = at(2026, time.October, 19, 8, 0)

	for _, actor := range []service.Actor{f.teacher, f.admin} {
		list, err := f.svc.Materials(ctx, actor, f.class.ID, f.lesson.ID)
		require.NoError(t, err, actor.Role)
		require.Len(t, list, 4)
		assert.Equal(t, []string{"Roteiro", "Lista", "Resolucao", "Apoio"}, titles(list), "the order of the teacher")
		visible := []bool{list[0].VisibleNow, list[1].VisibleNow, list[2].VisibleNow, list[3].VisibleNow}
		assert.Equal(t, []bool{true, false, false, false}, visible)
		assert.Nil(t, list[0].HiddenUntil)
		assert.Equal(t, domain.HiddenUntilClassStart, list[1].HiddenUntil.Reason)
		assert.Equal(t, domain.HiddenUntilClassEnd, list[2].HiddenUntil.Reason)
		assert.Equal(t, domain.HiddenUntilClassStart, list[3].HiddenUntil.Reason)
	}

	f.now = at(2026, time.October, 19, 10, 30)
	list, err := f.svc.Materials(ctx, f.teacher, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.False(t, list[1].VisibleNow)
	assert.Equal(t, domain.HiddenUntilClassOver, list[1].HiddenUntil.Reason, "the one only for during the lesson, once it is over")
}

// Covers SPEC-074 CA-04 and CA-07: the address of a file is for who may see the material; a hidden one answers as a material that does not
// exist, so the student learns nothing of it.
func TestDownload_HiddenIs404ForStudent(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	solution := f.addFile(t, f.teacher, "Resolução", domain.MaterialExerciseSolution, domain.VisibilityAfterClass)
	link := f.addLink(t, "Site", domain.MaterialReference, domain.VisibilityAlways)
	f.now = at(2026, time.October, 19, 9, 0)

	_, err := f.svc.MaterialDownload(ctx, f.student, f.class.ID, f.lesson.ID, solution.ID)
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound, "hidden: not found")
	got, err := f.svc.MaterialDownload(ctx, f.teacher, f.class.ID, f.lesson.ID, solution.ID)
	require.NoError(t, err, "the teacher gets the hidden one")
	assert.Contains(t, got.URL, *solution.ObjectKey)
	assert.Contains(t, got.URL, "ttl=15m")
	assert.True(t, f.now.Add(15*time.Minute).Equal(got.ExpiresAt))

	f.now = at(2026, time.October, 19, 10, 0)
	got, err = f.svc.MaterialDownload(ctx, f.student, f.class.ID, f.lesson.ID, solution.ID)
	require.NoError(t, err, "visible now")
	assert.Contains(t, got.URL, "ttl=15m")

	_, err = f.svc.MaterialDownload(ctx, f.student, f.class.ID, f.lesson.ID, link.ID)
	assert.ErrorIs(t, err, domain.ErrNotAFile, "a link has no file")
	_, err = f.svc.MaterialDownload(ctx, f.student, f.class.ID, f.lesson.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound)
	_, err = f.svc.MaterialDownload(ctx, service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}, f.class.ID, f.lesson.ID, solution.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a student that is not of the class")
}

// Covers SPEC-074 CA-05 and RN-04: "release now" records the clock of the server and the student sees the material right away; if it is
// already visible there is nothing to release.
func TestRelease_NowAndAlreadyVisible(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	always, _, after, _ := f.fourPhases(t)
	f.now = at(2026, time.October, 19, 9, 0)

	list, err := f.svc.Materials(ctx, f.student, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.NotContains(t, titles(list), "Resolucao")

	released, err := f.svc.ReleaseMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, after.ID)
	require.NoError(t, err)
	require.NotNil(t, released.ReleaseAt)
	assert.True(t, f.now.Equal(*released.ReleaseAt), "the now of the server")
	assert.True(t, released.VisibleNow)
	assert.Nil(t, released.HiddenUntil)

	list, err = f.svc.Materials(ctx, f.student, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.Contains(t, titles(list), "Resolucao", "the next reading of the student has it")

	_, err = f.svc.ReleaseMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, after.ID)
	assert.ErrorIs(t, err, domain.ErrAlreadyVisible)
	_, err = f.svc.ReleaseMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, always.ID)
	assert.ErrorIs(t, err, domain.ErrAlreadyVisible)
	_, err = f.svc.ReleaseMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound)
}

// Covers SPEC-074 CA-08 and RN-03: only the owner teacher and an administrator write; a student of the class reads; a lesson of another
// class is not found.
func TestMaterials_Permissions(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	m := f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	otherTeacher := service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	outsider := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	link := service.LinkMaterialInput{MaterialInput: domain.MaterialInput{Title: "x", Kind: domain.MaterialSlides, Visibility: domain.VisibilityAlways}, URL: "https://a.com"}
	title := "y"

	for _, actor := range []service.Actor{f.student, otherTeacher, outsider} {
		_, err := f.svc.AddLinkMaterial(ctx, actor, f.class.ID, f.lesson.ID, link)
		assert.ErrorIs(t, err, domain.ErrForbidden, actor.Role)
		_, err = f.svc.AddFileMaterial(ctx, actor, f.class.ID, f.lesson.ID, service.FileMaterialInput{MaterialInput: link.MaterialInput, PageCount: 1, File: bytes.NewReader(pdf())})
		assert.ErrorIs(t, err, domain.ErrForbidden, actor.Role)
		_, err = f.svc.UpdateMaterial(ctx, actor, f.class.ID, f.lesson.ID, m.ID, service.MaterialChange{Title: &title})
		assert.ErrorIs(t, err, domain.ErrForbidden, actor.Role)
		_, err = f.svc.ReleaseMaterial(ctx, actor, f.class.ID, f.lesson.ID, m.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden, actor.Role)
		assert.ErrorIs(t, f.svc.DeleteMaterial(ctx, actor, f.class.ID, f.lesson.ID, m.ID), domain.ErrForbidden, actor.Role)
	}
	assert.Equal(t, "A", f.repo.materials[m.ID].Title)
	assert.Len(t, f.repo.materials, 1)
	assert.Empty(t, f.store.puts)

	_, err := f.svc.Materials(ctx, otherTeacher, f.class.ID, f.lesson.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.Materials(ctx, outsider, f.class.ID, f.lesson.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a student of no enrollment does not learn the class exists")
	list, err := f.svc.Materials(ctx, f.student, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"A"}, titles(list))

	_, err = f.svc.AddLinkMaterial(ctx, f.admin, f.class.ID, f.lesson.ID, link)
	assert.NoError(t, err, "an administrator writes in any class")

	_, err = f.svc.Materials(ctx, f.teacher, f.class.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	foreign := domain.ClassSession{ClassID: uuid.New(), Date: f.lesson.Date, StartTime: f.lesson.StartTime, EndTime: f.lesson.EndTime}
	foreign.ID = uuid.New()
	f.repo.sessions[foreign.ID] = foreign
	_, err = f.svc.AddLinkMaterial(ctx, f.teacher, f.class.ID, foreign.ID, link)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a lesson of another class")
}

// Covers SPEC-074 CA-09 and RN-07: a lesson that has a material has content: it is not dropped when the weekly lessons are regenerated, and
// saving its content with nothing else in it does not say otherwise.
func TestHasContent_CountsMaterials(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	require.False(t, f.repo.sessions[f.lesson.ID].HasContent)

	f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent)

	_, err := f.svc.SaveContent(ctx, f.teacher, f.class.ID, f.lesson.ID, service.ContentInput{})
	require.NoError(t, err)
	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent, "the content of the lesson is empty but it has a material")

	// a lesson with a topic keeps its content after its last material goes
	_, err = f.svc.SaveContent(ctx, f.teacher, f.class.ID, f.lesson.ID, service.ContentInput{Topic: "Permissões"})
	require.NoError(t, err)
	list, err := f.svc.Materials(ctx, f.teacher, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, list[0].ID))
	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent, "the topic is content")

	// a lesson with a link of the content keeps it too
	_, err = f.svc.SaveContent(ctx, f.teacher, f.class.ID, f.lesson.ID, service.ContentInput{Links: []domain.LinkInput{{Name: "Meet", URL: "https://meet.google.com/x"}}})
	require.NoError(t, err)
	extra := f.addLink(t, "B", domain.MaterialSlides, domain.VisibilityAlways)
	require.NoError(t, f.svc.DeleteMaterial(ctx, f.teacher, f.class.ID, f.lesson.ID, extra.ID))
	assert.True(t, f.repo.sessions[f.lesson.ID].HasContent, "the link is content")
}

// Covers SPEC-074 CA-09 and RN-07: regenerating the weekly lessons keeps the one that has a material, and drops the empty ones.
func TestRegenerationKeepsSessionsWithMaterials(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	f.now = at(2026, time.October, 13, 10, 0)
	f.addLink(t, "A", domain.MaterialSlides, domain.VisibilityAlways)
	empty := f.on(t, day(2026, 10, 26)).ID

	_, err := f.svc.ReplaceMeetings(ctx, f.teacher, f.class.ID, []domain.WeeklyMeeting{
		{Weekday: 1, StartTime: clk("08:20"), EndTime: clk("10:00"), LessonCount: 2, Mode: domain.ModeInPerson, Room: str("C-101")},
	})
	require.NoError(t, err)
	_, kept := f.repo.sessions[f.lesson.ID]
	assert.True(t, kept, "the lesson with a material is kept")
	assert.Len(t, f.repo.materials, 1)
	_, stillThere := f.repo.sessions[empty]
	assert.False(t, stillThere, "the empty lesson was regenerated")
}

// Covers SPEC-074 CA-09 and RN-04, RN-05: the timeline counts the materials the reader sees in each lesson, and the diary has the list, the
// same one the list route gives, already filtered, from the rooms the timeline reads anyway.
func TestTimelineAndDiary_CarryMaterials(t *testing.T) {
	f := newMaterialFixture(t)
	ctx := context.Background()
	f.fourPhases(t)
	f.now = at(2026, time.October, 19, 9, 0) // the lesson is current: under way

	tl, err := f.svc.Timeline(ctx, f.student, f.class.ID)
	require.NoError(t, err)
	require.NotNil(t, tl.Current)
	assert.Equal(t, f.lesson.ID, tl.Current.Session.ID)
	assert.Equal(t, 3, tl.Current.MaterialCount, "the student: always, during, during and after")
	assert.Equal(t, 0, tl.Upcoming[0].MaterialCount)

	tl, err = f.svc.Timeline(ctx, f.teacher, f.class.ID)
	require.NoError(t, err)
	assert.Equal(t, 4, tl.Current.MaterialCount, "the teacher reads them all")

	diary, err := f.svc.Diary(ctx, f.student, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Roteiro", "Lista", "Apoio"}, titles(diary.Materials))
	assert.Equal(t, 3, diary.Entry.MaterialCount)
	diary, err = f.svc.Diary(ctx, f.teacher, f.class.ID, f.lesson.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Roteiro", "Lista", "Resolucao", "Apoio"}, titles(diary.Materials))

	// the materials of the lessons come in one reading, with the rooms of the same reading
	f.live.calls = 0
	_, err = f.svc.Timeline(ctx, f.student, f.class.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, f.live.calls)
}
