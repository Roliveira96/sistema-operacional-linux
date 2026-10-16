package service

import (
	"bytes"
	"context"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// The materials of a lesson (SPEC-074).

const (
	// MaterialDownloadTTL is how long the signed address of a file lives (SPEC-074 RN-02).
	MaterialDownloadTTL = 15 * time.Minute

	// maxMaterialBytes is read from a file at most: the biggest of the formats, plus one byte so a file over it is told. The limit of each format
	// is the one of the classifier.
	maxMaterialBytes = 25 << 20

	// liveActive is the status of a room of the live classroom that is open.
	liveActive = "ACTIVE"
)

// ClassifiedFile is what the classifier learns of a file, by its first bytes: its type, the extension for the key in the bucket and its pages.
type ClassifiedFile struct {
	ContentType string
	Extension   string
	PageCount   int
}

// MaterialFiles is what the schedule needs to check a file sent as a material, by its first bytes and not by its name (SPEC-074 RN-02): PDF,
// PNG, JPEG or WebP, with the limit of each. It answers domain.ErrInvalidMaterialFile (with the field) and domain.ErrMaterialFileTooLarge. The
// presentations of the live classroom already do that; it is implemented in the composition root.
type MaterialFiles interface {
	Classify(pageCount int, size int64, header []byte) (ClassifiedFile, error)
}

// MaterialStore is the bucket the files of the materials go to.
type MaterialStore interface {
	PutObject(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	PresignedGetURL(ctx context.Context, key string, ttl time.Duration) (string, error)
}

// WithMaterials plugs in the validation of the files and the bucket. Without them, a file cannot be sent; the links work.
func (s *Service) WithMaterials(files MaterialFiles, store MaterialStore) *Service {
	s.files, s.store = files, store
	return s
}

// FileMaterialInput is a file sent as a material of a lesson.
type FileMaterialInput struct {
	domain.MaterialInput
	FileName  string
	PageCount int
	Size      int64
	File      io.Reader
}

// LinkMaterialInput is a link sent as a material of a lesson.
type LinkMaterialInput struct {
	domain.MaterialInput
	URL string
}

// MaterialChange is what the teacher changes in a material. Only what is set changes; a release is set with SetReleaseAt, and cleared when
// ReleaseAt is nil. The source (file or link) never changes (SPEC-074 section 5).
type MaterialChange struct {
	Title        *string
	Kind         *domain.MaterialKind
	Visibility   *domain.MaterialVisibility
	SetReleaseAt bool
	ReleaseAt    *time.Time
	Position     *int
}

// MaterialView is a material as the reader gets it: for a student, only what is visible, and so VisibleNow is true and there is nothing to
// wait for; for the teacher and the administrator, all of them, with whether each is visible and, if not, until when (SPEC-074 RN-05).
type MaterialView struct {
	domain.ClassSessionMaterial
	VisibleNow  bool
	HiddenUntil *domain.HiddenUntil
}

// Download is the signed address of a file and when it stops working.
type Download struct {
	URL       string
	ExpiresAt time.Time
}

func isStaff(actor Actor) bool { return actor.Role != authn.RoleStudent }

// liveStateOf tells what the rooms linked to a lesson say of it: one is open, or one was closed.
func liveStateOf(rooms []LiveSummary) domain.LiveState {
	var live domain.LiveState
	for _, r := range rooms {
		if r.Status == liveActive {
			live.Active = true
		}
		if r.EndedAt != nil {
			live.Ended = true
		}
	}
	return live
}

// viewOf is a material as who reads it gets it; false for a student when it is not visible.
func viewOf(actor Actor, m domain.ClassSessionMaterial, session domain.ClassSession, live domain.LiveState, now time.Time) (MaterialView, bool) {
	hidden, isHidden := m.HiddenUntil(session, live, now)
	if isHidden && !isStaff(actor) {
		return MaterialView{}, false
	}
	view := MaterialView{ClassSessionMaterial: m, VisibleNow: !isHidden}
	if isHidden {
		view.HiddenUntil = &hidden
	}
	return view, true
}

// materialViews are the materials of a lesson as who reads them gets them, in the order of the teacher.
func materialViews(actor Actor, session domain.ClassSession, rooms []LiveSummary, list []domain.ClassSessionMaterial, now time.Time) []MaterialView {
	live := liveStateOf(rooms)
	out := make([]MaterialView, 0, len(list))
	for _, m := range list {
		if view, ok := viewOf(actor, m, session, live, now); ok {
			out = append(out, view)
		}
	}
	return out
}

// lessonOf finds the lesson of the class for who writes (SPEC-074 RN-03) or for who reads it.
func (s *Service) lessonOf(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, write bool) (domain.ClassSession, error) {
	var err error
	if write {
		_, err = s.writableClass(ctx, actor, classID)
	} else {
		_, err = s.readableClass(ctx, actor, classID)
	}
	if err != nil {
		return domain.ClassSession{}, err
	}
	return s.sessionOfClass(ctx, classID, sessionID)
}

// materialsOf reads the materials of a lesson in the order of the teacher.
func (s *Service) materialsOf(ctx context.Context, sessionID uuid.UUID) ([]domain.ClassSessionMaterial, error) {
	all, err := s.repo.ListMaterials(ctx, []uuid.UUID{sessionID})
	return all[sessionID], err
}

// viewNow is one material as who writes it gets it (a teacher or an administrator), now.
func (s *Service) viewNow(ctx context.Context, actor Actor, session domain.ClassSession, m domain.ClassSessionMaterial) (MaterialView, error) {
	rooms, err := s.linkedRooms(ctx, []domain.ClassSession{session})
	if err != nil {
		return MaterialView{}, err
	}
	view, _ := viewOf(actor, m, session, liveStateOf(rooms[session.ID]), s.now())
	return view, nil
}

// Materials lists the materials of a lesson (SPEC-074 RN-04, RN-05): the teacher and the administrator get them all; a student of the class
// gets the ones visible now, and not even a count of the rest.
func (s *Service) Materials(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) ([]MaterialView, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, false)
	if err != nil {
		return nil, err
	}
	list, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	rooms, err := s.linkedRooms(ctx, []domain.ClassSession{session})
	if err != nil {
		return nil, err
	}
	return materialViews(actor, session, rooms[session.ID], list, s.now()), nil
}

// AddFileMaterial stores a file as the last material of a lesson (SPEC-074 CA-01, RN-02): it is checked by its first bytes, put in the bucket
// under a key the server makes, and only then recorded.
func (s *Service) AddFileMaterial(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, in FileMaterialInput) (MaterialView, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, true)
	if err != nil {
		return MaterialView{}, err
	}
	existing, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return MaterialView{}, err
	}
	if len(existing) >= domain.MaxMaterialsPerSession {
		return MaterialView{}, domain.ErrMaterialLimitExceeded
	}
	if s.files == nil || s.store == nil || in.File == nil {
		return MaterialView{}, &domain.FieldError{Field: "file", Err: domain.ErrInvalidMaterialFile}
	}
	data, err := io.ReadAll(io.LimitReader(in.File, maxMaterialBytes+1))
	if err != nil {
		return MaterialView{}, err
	}
	size := in.Size
	if int64(len(data)) > size {
		size = int64(len(data))
	}
	header := data
	if len(header) > 12 {
		header = header[:12]
	}
	file, err := s.files.Classify(in.PageCount, size, header)
	if err != nil {
		return MaterialView{}, err
	}
	key := "classes/" + classID.String() + "/sessions/" + sessionID.String() + "/materials/" + uuid.NewString() + file.Extension
	m, err := domain.NewFileMaterial(sessionID, actor.UserID, in.MaterialInput,
		domain.MaterialFile{ObjectKey: key, ContentType: file.ContentType, FileName: in.FileName, Size: size, PageCount: file.PageCount})
	if err != nil {
		return MaterialView{}, err
	}
	m.Position = len(existing)
	if err := s.store.PutObject(ctx, key, bytes.NewReader(data), int64(len(data)), file.ContentType); err != nil {
		return MaterialView{}, err
	}
	return s.record(ctx, actor, session, m)
}

// AddLinkMaterial includes a link as the last material of a lesson (SPEC-074 CA-02).
func (s *Service) AddLinkMaterial(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, in LinkMaterialInput) (MaterialView, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, true)
	if err != nil {
		return MaterialView{}, err
	}
	existing, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return MaterialView{}, err
	}
	if len(existing) >= domain.MaxMaterialsPerSession {
		return MaterialView{}, domain.ErrMaterialLimitExceeded
	}
	m, err := domain.NewLinkMaterial(sessionID, actor.UserID, in.MaterialInput, in.URL)
	if err != nil {
		return MaterialView{}, err
	}
	m.Position = len(existing)
	return s.record(ctx, actor, session, m)
}

// record saves a new material and marks the lesson as one that has content, which keeps it when the weekly lessons are regenerated
// (SPEC-074 RN-07). It is not a change of the lesson: no change mark, no reason, no e-mail (RN-03).
func (s *Service) record(ctx context.Context, actor Actor, session domain.ClassSession, m domain.ClassSessionMaterial) (MaterialView, error) {
	if err := s.repo.CreateMaterial(ctx, &m); err != nil {
		return MaterialView{}, err
	}
	if !session.HasContent {
		if err := s.repo.SetHasContent(ctx, session.ID, true); err != nil {
			return MaterialView{}, err
		}
	}
	return s.viewNow(ctx, actor, session, m)
}

// find looks for a material among those of the lesson, so one of another lesson is not found through this one.
func find(list []domain.ClassSessionMaterial, id uuid.UUID) int {
	for i, m := range list {
		if m.ID == id {
			return i
		}
	}
	return -1
}

// UpdateMaterial changes a material of a lesson (SPEC-074 CA-03): its title, kind, phase, release or position, the others taking their places.
func (s *Service) UpdateMaterial(ctx context.Context, actor Actor, classID, sessionID, materialID uuid.UUID, change MaterialChange) (MaterialView, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, true)
	if err != nil {
		return MaterialView{}, err
	}
	list, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return MaterialView{}, err
	}
	at := find(list, materialID)
	if at < 0 {
		return MaterialView{}, domain.ErrMaterialNotFound
	}
	m := list[at]
	if change.Title != nil {
		if m.Title, err = domain.NormalizeMaterialTitle(*change.Title); err != nil {
			return MaterialView{}, err
		}
	}
	if change.Kind != nil {
		if !domain.ValidMaterialKind(*change.Kind) {
			return MaterialView{}, &domain.FieldError{Field: "kind", Err: domain.ErrInvalidMaterial}
		}
		m.Kind = *change.Kind
	}
	if change.Visibility != nil {
		if !domain.ValidMaterialVisibility(*change.Visibility) {
			return MaterialView{}, &domain.FieldError{Field: "visibility", Err: domain.ErrInvalidMaterial}
		}
		m.Visibility = *change.Visibility
	}
	if change.SetReleaseAt {
		m.ReleaseAt = change.ReleaseAt
	}
	list[at] = m
	if change.Position != nil {
		if *change.Position < 0 {
			return MaterialView{}, &domain.FieldError{Field: "position", Err: domain.ErrInvalidMaterial}
		}
		to := min(*change.Position, len(list)-1)
		rest := append(append([]domain.ClassSessionMaterial{}, list[:at]...), list[at+1:]...)
		list = append(rest[:to:to], append([]domain.ClassSessionMaterial{m}, rest[to:]...)...)
	}
	var changed []domain.ClassSessionMaterial
	for i := range list {
		if list[i].Position != i || list[i].ID == materialID {
			list[i].Position = i
			changed = append(changed, list[i])
		}
	}
	if err := s.repo.SaveMaterials(ctx, changed); err != nil {
		return MaterialView{}, err
	}
	return s.viewNow(ctx, actor, session, list[find(list, materialID)])
}

// ReleaseMaterial makes a hidden material visible now: it records the clock of the server as its release (SPEC-074 CA-05).
func (s *Service) ReleaseMaterial(ctx context.Context, actor Actor, classID, sessionID, materialID uuid.UUID) (MaterialView, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, true)
	if err != nil {
		return MaterialView{}, err
	}
	list, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return MaterialView{}, err
	}
	at := find(list, materialID)
	if at < 0 {
		return MaterialView{}, domain.ErrMaterialNotFound
	}
	rooms, err := s.linkedRooms(ctx, []domain.ClassSession{session})
	if err != nil {
		return MaterialView{}, err
	}
	now := s.now()
	m := list[at]
	if m.VisibleAt(session, liveStateOf(rooms[session.ID]), now) {
		return MaterialView{}, domain.ErrAlreadyVisible
	}
	m.ReleaseAt = &now
	if err := s.repo.SaveMaterials(ctx, []domain.ClassSessionMaterial{m}); err != nil {
		return MaterialView{}, err
	}
	return s.viewNow(ctx, actor, session, m)
}

// DeleteMaterial removes a material from a lesson, logically: the object stays in the bucket, the others close the gap and a lesson with
// nothing else in it stops counting as one that has content (SPEC-074 CA-03, RN-06, RN-07).
func (s *Service) DeleteMaterial(ctx context.Context, actor Actor, classID, sessionID, materialID uuid.UUID) error {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, true)
	if err != nil {
		return err
	}
	list, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return err
	}
	at := find(list, materialID)
	if at < 0 {
		return domain.ErrMaterialNotFound
	}
	if err := s.repo.DeleteMaterial(ctx, materialID); err != nil {
		return err
	}
	var closed []domain.ClassSessionMaterial
	for i, m := range append(list[:at:at], list[at+1:]...) {
		if m.Position != i {
			m.Position = i
			closed = append(closed, m)
		}
	}
	if len(closed) > 0 {
		if err := s.repo.SaveMaterials(ctx, closed); err != nil {
			return err
		}
	}
	return s.refreshHasContent(ctx, session, len(list)-1)
}

// refreshHasContent brings the flag of content of a lesson up to date after its last material may have gone: it has content if anything is in
// it (SPEC-074 RN-07).
func (s *Service) refreshHasContent(ctx context.Context, session domain.ClassSession, materials int) error {
	links, err := s.repo.ListSessionLinks(ctx, session.ID)
	if err != nil {
		return err
	}
	has := session.HasOwnContent() || len(links) > 0 || materials > 0
	if has == session.HasContent {
		return nil
	}
	return s.repo.SetHasContent(ctx, session.ID, has)
}

// MaterialDownload gives the signed address of a file of a lesson for 15 minutes (SPEC-074 CA-07). To a student, a material that is not
// visible now is a material that does not exist.
func (s *Service) MaterialDownload(ctx context.Context, actor Actor, classID, sessionID, materialID uuid.UUID) (Download, error) {
	session, err := s.lessonOf(ctx, actor, classID, sessionID, false)
	if err != nil {
		return Download{}, err
	}
	list, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return Download{}, err
	}
	at := find(list, materialID)
	if at < 0 {
		return Download{}, domain.ErrMaterialNotFound
	}
	rooms, err := s.linkedRooms(ctx, []domain.ClassSession{session})
	if err != nil {
		return Download{}, err
	}
	now := s.now()
	m := list[at]
	if !isStaff(actor) && !m.VisibleAt(session, liveStateOf(rooms[session.ID]), now) {
		return Download{}, domain.ErrMaterialNotFound
	}
	if !m.IsFile() || s.store == nil {
		return Download{}, domain.ErrNotAFile
	}
	address, err := s.store.PresignedGetURL(ctx, *m.ObjectKey, MaterialDownloadTTL)
	if err != nil {
		return Download{}, err
	}
	return Download{URL: address, ExpiresAt: now.Add(MaterialDownloadTTL)}, nil
}

// materialCount is how many materials of a lesson the reader sees: the teacher, all; a student, the visible ones.
func materialCount(actor Actor, session domain.ClassSession, rooms []LiveSummary, list []domain.ClassSessionMaterial, now time.Time) int {
	if isStaff(actor) {
		return len(list)
	}
	return len(materialViews(actor, session, rooms, list, now))
}
