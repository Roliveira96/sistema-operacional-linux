// Package service has the rules of the live classroom (SPEC-051): who may start and end a room, the presentations, the queue of raised
// hands, the notes of the students and the state that a student who comes in the middle of the lesson receives.
package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ClassInfo is what the service needs to know about a class.
type ClassInfo struct {
	ID        uuid.UUID
	TeacherID uuid.UUID
	Archived  bool
}

// Repository is what the service needs from the persistence.
type Repository interface {
	FindClass(ctx context.Context, id uuid.UUID) (ClassInfo, error)
	IsActiveStudent(ctx context.Context, classID, userID uuid.UUID) (bool, error)
	ClassSessionBelongsToClass(ctx context.Context, classSessionID, classID uuid.UUID) (bool, error)
	ModuleExists(ctx context.Context, id uuid.UUID) (bool, error)

	FindActiveSession(ctx context.Context, classID uuid.UUID) (domain.LiveClassroomSession, error)
	FindSession(ctx context.Context, id uuid.UUID) (domain.LiveClassroomSession, error)
	// CreateSession returns domain.ErrActiveSessionExists when the class already has an open room.
	CreateSession(ctx context.Context, s *domain.LiveClassroomSession) error
	SaveSession(ctx context.Context, s *domain.LiveClassroomSession) error
	TouchSession(ctx context.Context, id uuid.UUID, now time.Time) error
	// ListSessions puts the open room first and then the ended ones, newest first.
	ListSessions(ctx context.Context, classID uuid.UUID, limit int) ([]domain.LiveClassroomSession, error)
	ListActiveSessions(ctx context.Context) ([]domain.LiveClassroomSession, error)
	SessionsWithNotes(ctx context.Context, studentID uuid.UUID, sessionIDs []uuid.UUID) (map[uuid.UUID]bool, error)

	CountDecks(ctx context.Context, classID uuid.UUID) (int64, error)
	// ListDecks puts the newest presentation first (SPEC-053).
	ListDecks(ctx context.Context, classID uuid.UUID) ([]domain.SlideDeck, error)
	CreateDeck(ctx context.Context, d *domain.SlideDeck) error
	FindDeck(ctx context.Context, id uuid.UUID) (domain.SlideDeck, error)

	// RaiseHand does nothing when a hand of the student is already waiting.
	RaiseHand(ctx context.Context, sessionID, studentID uuid.UUID, now time.Time) error
	ListHandRaises(ctx context.Context, sessionID uuid.UUID) ([]domain.HandRaiseEntry, error)
	ResolveHand(ctx context.Context, sessionID, studentID uuid.UUID, status string, now time.Time) error
	ResolveAllHands(ctx context.Context, sessionID uuid.UUID, now time.Time) error

	SaveNote(ctx context.Context, sessionID, studentID uuid.UUID, content string) (domain.LiveClassroomNote, error)
	FindNote(ctx context.Context, sessionID, studentID uuid.UUID) (domain.LiveClassroomNote, error)

	// FindAdmission returns domain.ErrAdmissionNotFound when the student never asked to come in (SPEC-054).
	FindAdmission(ctx context.Context, sessionID, studentID uuid.UUID) (domain.LiveClassroomAdmission, error)
	// UpsertAdmission creates the row or changes its status; waiting puts the student at the end of the line.
	UpsertAdmission(ctx context.Context, sessionID, studentID uuid.UUID, status string, now time.Time, decidedBy *uuid.UUID) (domain.LiveClassroomAdmission, error)
	// ListAdmissions returns who waits and who is admitted, first in first served, without the removed.
	ListAdmissions(ctx context.Context, sessionID uuid.UUID) ([]domain.AdmissionEntry, error)
	AdmitAllWaiting(ctx context.Context, sessionID uuid.UUID, now time.Time, decidedBy *uuid.UUID) ([]uuid.UUID, error)
}

// ModuleBlock is a block of the lesson of a module, as the room shows it.
type ModuleBlock struct {
	ID       string
	Type     string
	Position int
	Payload  json.RawMessage
}

// ModuleView is the module of the room: its blocks and the machine the terminal starts from (SPEC-054 RN-07).
type ModuleView struct {
	ID     uuid.UUID
	Title  string
	Blocks []ModuleBlock
	// Scenario is the prepared machine of the module topic, or nil for the default machine; Setup is the snapshot of the module, which
	// the study screen applies on top of it, together with the setups of the cards.
	Scenario json.RawMessage
	Setup    json.RawMessage
}

// Modules is what the service needs from the teaching modules. The room reads them for its students, who have no access of their own.
type Modules interface {
	// Available returns domain.ErrModuleNotFound when the module does not exist or the actor cannot use it.
	Available(ctx context.Context, actor Actor, moduleID uuid.UUID) error
	Read(ctx context.Context, moduleID uuid.UUID) (ModuleView, error)
}

// Storage keeps the files of the presentations.
type Storage interface {
	PutObject(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	PresignedGetURL(ctx context.Context, key string, ttl time.Duration) (string, error)
}

// Actor is who is calling.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// Service runs the use cases.
type Service struct {
	repo    Repository
	store   Storage
	now     func() time.Time
	onEnded func(sessionID uuid.UUID)
	live    *liveStates
	modules Modules
}

// New creates the service.
func New(repo Repository, store Storage, now func() time.Time) *Service {
	return &Service{repo: repo, store: store, now: now, live: newLiveStates()}
}

// WithOnEnded sets what runs when a room ends, to close its connections.
func (s *Service) WithOnEnded(fn func(sessionID uuid.UUID)) *Service {
	s.onEnded = fn
	return s
}

// WithModules sets the reader of the teaching modules. Without it, the room only checks that a module exists and cannot read one.
func (s *Service) WithModules(m Modules) *Service {
	s.modules = m
	return s
}

func isTeacherSide(role string) bool { return role == authn.RoleTeacher || role == authn.RoleAdmin }

// writable returns the class when the actor may run its live classroom: the owner teacher or an administrator.
func (s *Service) writable(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if !isTeacherSide(actor.Role) {
		return ClassInfo{}, domain.ErrForbidden
	}
	class, err := s.repo.FindClass(ctx, classID)
	if err != nil {
		return ClassInfo{}, err
	}
	if actor.Role != authn.RoleAdmin && class.TeacherID != actor.UserID {
		return ClassInfo{}, domain.ErrForbidden
	}
	return class, nil
}

// readable returns the class when the actor may see its live classroom: who runs it, or a student with an active enrollment.
func (s *Service) readable(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if actor.Role != authn.RoleStudent {
		return s.writable(ctx, actor, classID)
	}
	class, err := s.repo.FindClass(ctx, classID)
	if err != nil {
		return ClassInfo{}, err
	}
	active, err := s.repo.IsActiveStudent(ctx, classID, actor.UserID)
	if err != nil {
		return ClassInfo{}, err
	}
	if !active {
		return ClassInfo{}, domain.ErrForbidden
	}
	return class, nil
}

// activeSession returns the open room by id, or ErrSessionNotFound.
func (s *Service) activeSession(ctx context.Context, id uuid.UUID) (domain.LiveClassroomSession, error) {
	session, err := s.repo.FindSession(ctx, id)
	if err != nil {
		return domain.LiveClassroomSession{}, err
	}
	if !session.IsActive() {
		return domain.LiveClassroomSession{}, domain.ErrSessionNotFound
	}
	return session, nil
}

// StartInput is what the teacher gives to start a room.
type StartInput struct {
	Title           string
	ClassSessionID  *uuid.UUID
	DeckID          *uuid.UUID
	InitialModuleID *uuid.UUID
}

// StartSession opens the live classroom of the class, at any hour, or gives back the one that is open (the title is then ignored). It
// reports whether it created a new one (RN-01).
func (s *Service) StartSession(ctx context.Context, actor Actor, classID uuid.UUID, in StartInput) (domain.LiveClassroomSession, bool, error) {
	class, err := s.writable(ctx, actor, classID)
	if err != nil {
		return domain.LiveClassroomSession{}, false, err
	}
	if class.Archived {
		return domain.LiveClassroomSession{}, false, domain.ErrClassArchived
	}
	title, err := domain.NormalizeTitle(in.Title)
	if err != nil {
		return domain.LiveClassroomSession{}, false, err
	}
	if open, err := s.repo.FindActiveSession(ctx, classID); err == nil {
		return open, false, nil
	} else if err != domain.ErrSessionNotFound {
		return domain.LiveClassroomSession{}, false, err
	}
	if err := s.checkLinks(ctx, classID, in); err != nil {
		return domain.LiveClassroomSession{}, false, err
	}

	session := domain.LiveClassroomSession{
		ClassID: classID, TeacherID: actor.UserID, ClassSessionID: in.ClassSessionID, DeckID: in.DeckID, ActiveModuleID: in.InitialModuleID,
		Title: title, DisplayMode: domain.ModeSlides, CurrentSlide: 1, Status: domain.StatusActive, StartedAt: s.now(),
	}
	if in.InitialModuleID != nil {
		session.DisplayMode = domain.ModeModule
	}
	if err := s.repo.CreateSession(ctx, &session); err != nil {
		if err == domain.ErrActiveSessionExists {
			// Another request opened it a moment before: that one is the room of the class.
			open, findErr := s.repo.FindActiveSession(ctx, classID)
			return open, false, findErr
		}
		return domain.LiveClassroomSession{}, false, err
	}
	return session, true, nil
}

// checkLinks makes sure that the deck and the lesson of the schedule are of the class and that the module exists (RN-04).
func (s *Service) checkLinks(ctx context.Context, classID uuid.UUID, in StartInput) error {
	if in.DeckID != nil {
		deck, err := s.repo.FindDeck(ctx, *in.DeckID)
		if err != nil {
			return err
		}
		if deck.ClassID != classID {
			return domain.ErrDeckNotFound
		}
	}
	if in.ClassSessionID != nil {
		ok, err := s.repo.ClassSessionBelongsToClass(ctx, *in.ClassSessionID, classID)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrClassSessionNotFound
		}
	}
	if in.InitialModuleID != nil {
		ok, err := s.repo.ModuleExists(ctx, *in.InitialModuleID)
		if err != nil {
			return err
		}
		if !ok {
			return domain.ErrModuleNotFound
		}
	}
	return nil
}

// EndSession closes the room. Ending is final (RN-02).
func (s *Service) EndSession(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (domain.LiveClassroomSession, error) {
	if _, err := s.writable(ctx, actor, classID); err != nil {
		return domain.LiveClassroomSession{}, err
	}
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return domain.LiveClassroomSession{}, err
	}
	if session.ClassID != classID {
		return domain.LiveClassroomSession{}, domain.ErrSessionNotFound
	}
	if err := s.finish(ctx, &session); err != nil {
		return domain.LiveClassroomSession{}, err
	}
	return session, nil
}

func (s *Service) finish(ctx context.Context, session *domain.LiveClassroomSession) error {
	session.End(s.now())
	if err := s.repo.SaveSession(ctx, session); err != nil {
		return err
	}
	s.live.forget(session.ID)
	if s.onEnded != nil {
		s.onEnded(session.ID)
	}
	return nil
}

// TeacherPresence records that the teacher was with the room, which is the moment the safety net counts from (RN-03).
func (s *Service) TeacherPresence(ctx context.Context, sessionID uuid.UUID) error {
	return s.repo.TouchSession(ctx, sessionID, s.now())
}

// EndAbandoned ends the open rooms that have been without their teacher for the safety net time (RN-03). connected tells whether the
// teacher is connected to a room right now. It returns how many rooms it ended.
func (s *Service) EndAbandoned(ctx context.Context, connected func(sessionID uuid.UUID) bool) (int, error) {
	sessions, err := s.repo.ListActiveSessions(ctx)
	if err != nil {
		return 0, err
	}
	now, ended := s.now(), 0
	for i := range sessions {
		session := sessions[i]
		if connected(session.ID) || now.Sub(session.UpdatedAt) < domain.SafetyNet {
			continue
		}
		if err := s.finish(ctx, &session); err != nil {
			return ended, err
		}
		ended++
	}
	return ended, nil
}

// UploadInput is a presentation sent by the teacher.
type UploadInput struct {
	Title     string
	PageCount int
	Size      int64
	File      io.Reader
}

// DeckView is a presentation with the signed address to read its file.
type DeckView struct {
	Deck        domain.SlideDeck
	DownloadURL string
}

// UploadDeck stores a presentation of the class (RN-04). The browser read the PDF and told how many pages it has; the server checks the
// header, the size and the limits.
func (s *Service) UploadDeck(ctx context.Context, actor Actor, classID uuid.UUID, in UploadInput) (DeckView, error) {
	if _, err := s.writable(ctx, actor, classID); err != nil {
		return DeckView{}, err
	}
	data, err := io.ReadAll(io.LimitReader(in.File, domain.MaxDeckBytes+1))
	if err != nil {
		return DeckView{}, err
	}
	size := in.Size
	if int64(len(data)) > size {
		size = int64(len(data))
	}
	header, _ := bufio.NewReader(bytes.NewReader(data)).Peek(5)
	title, err := domain.ValidateDeck(in.Title, in.PageCount, size, header)
	if err != nil {
		return DeckView{}, err
	}
	count, err := s.repo.CountDecks(ctx, classID)
	if err != nil {
		return DeckView{}, err
	}
	if count >= domain.MaxDecksPerClass {
		return DeckView{}, domain.ErrDeckLimit
	}

	deck := domain.SlideDeck{ClassID: classID, UploadedBy: actor.UserID, Title: title, PageCount: in.PageCount}
	deck.ID = uuid.New()
	deck.ObjectKey = "classes/" + classID.String() + "/decks/" + deck.ID.String() + ".pdf"
	if err := s.store.PutObject(ctx, deck.ObjectKey, bytes.NewReader(data), int64(len(data)), "application/pdf"); err != nil {
		return DeckView{}, err
	}
	if err := s.repo.CreateDeck(ctx, &deck); err != nil {
		return DeckView{}, err
	}
	return s.deckView(ctx, deck)
}

// ListDecks lists the presentations of the class, newest first, for the teacher to pick one already sent (SPEC-053). Only who runs the class
// lists them.
func (s *Service) ListDecks(ctx context.Context, actor Actor, classID uuid.UUID) ([]domain.SlideDeck, error) {
	if _, err := s.writable(ctx, actor, classID); err != nil {
		return nil, err
	}
	return s.repo.ListDecks(ctx, classID)
}

func (s *Service) deckView(ctx context.Context, deck domain.SlideDeck) (DeckView, error) {
	url, err := s.store.PresignedGetURL(ctx, deck.ObjectKey, domain.DownloadURLTTL)
	return DeckView{Deck: deck, DownloadURL: url}, err
}

// Active is the state of the open room of a class.
type Active struct {
	Found    bool
	Session  domain.LiveClassroomSession
	Deck     *DeckView
	Drawings []json.RawMessage
	// TerminalScreen is the last screen of the terminal of the teacher, as the window of the presenter sent it (SPEC-056); empty before the
	// first one.
	TerminalScreen json.RawMessage
	HandRaises     []domain.HandRaiseEntry
	// ModuleFocusBlockID is the block of the module the teacher put in focus.
	ModuleFocusBlockID string
	// StageView is the scroll of the panes and the divider of the module as the teacher left them (SPEC-057).
	StageView StageView
}

// GetActive returns the open room of the class with its state, with a renewed address for the deck (RN-07).
func (s *Service) GetActive(ctx context.Context, actor Actor, classID uuid.UUID) (Active, error) {
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return Active{}, err
	}
	session, err := s.repo.FindActiveSession(ctx, classID)
	if err == domain.ErrSessionNotFound {
		return Active{}, nil
	}
	if err != nil {
		return Active{}, err
	}
	return s.stateOf(ctx, session)
}

// Snapshot returns the state of an open room, for who connects or reconnects (RN-07).
func (s *Service) Snapshot(ctx context.Context, sessionID uuid.UUID) (Active, error) {
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return Active{}, err
	}
	return s.stateOf(ctx, session)
}

func (s *Service) stateOf(ctx context.Context, session domain.LiveClassroomSession) (Active, error) {
	a := Active{Found: true, Session: session}
	if session.DeckID != nil {
		deck, err := s.repo.FindDeck(ctx, *session.DeckID)
		if err != nil {
			return Active{}, err
		}
		view, err := s.deckView(ctx, deck)
		if err != nil {
			return Active{}, err
		}
		a.Deck = &view
	}
	a.Drawings, a.TerminalScreen = s.live.view(session.ID)
	hands, err := s.repo.ListHandRaises(ctx, session.ID)
	if err != nil {
		return Active{}, err
	}
	a.HandRaises = hands
	a.ModuleFocusBlockID = s.live.focus(session.ID)
	a.StageView = s.live.stageView(session.ID)
	return a, nil
}

// SessionSummary is a room in the list of the class.
type SessionSummary struct {
	Session         domain.LiveClassroomSession
	DurationMinutes int
	HasNotes        bool
}

// ListSessions returns the rooms of the class, the open one first (SPEC-051 section 5.5). Only a student is told whether he has notes.
func (s *Service) ListSessions(ctx context.Context, actor Actor, classID uuid.UUID) ([]SessionSummary, error) {
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return nil, err
	}
	sessions, err := s.repo.ListSessions(ctx, classID, domain.MaxListedSessions)
	if err != nil {
		return nil, err
	}
	var withNotes map[uuid.UUID]bool
	if actor.Role == authn.RoleStudent {
		ids := make([]uuid.UUID, len(sessions))
		for i, session := range sessions {
			ids[i] = session.ID
		}
		if withNotes, err = s.repo.SessionsWithNotes(ctx, actor.UserID, ids); err != nil {
			return nil, err
		}
	}
	out := make([]SessionSummary, len(sessions))
	for i, session := range sessions {
		out[i] = SessionSummary{Session: session, DurationMinutes: session.DurationMinutes(), HasNotes: withNotes[session.ID]}
	}
	return out, nil
}

// studentRoom returns the room of the class for the student who writes in it (the teacher never reads the notes).
func (s *Service) studentRoom(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (domain.LiveClassroomSession, error) {
	if actor.Role != authn.RoleStudent {
		return domain.LiveClassroomSession{}, domain.ErrForbidden
	}
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return domain.LiveClassroomSession{}, err
	}
	session, err := s.repo.FindSession(ctx, sessionID)
	if err != nil {
		return domain.LiveClassroomSession{}, err
	}
	if session.ClassID != classID {
		return domain.LiveClassroomSession{}, domain.ErrSessionNotFound
	}
	// The notes of a lesson that ended stay with who wrote them; while it goes on, only the admitted student has them (SPEC-054 RN-03).
	if session.IsActive() {
		if err := s.requireAdmitted(ctx, sessionID, actor.UserID); err != nil {
			return domain.LiveClassroomSession{}, err
		}
	}
	return session, nil
}

// SaveNote saves the private notes of the student in the room.
func (s *Service) SaveNote(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, content string) (domain.LiveClassroomNote, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return domain.LiveClassroomNote{}, err
	}
	if err := domain.ValidateNote(content); err != nil {
		return domain.LiveClassroomNote{}, err
	}
	return s.repo.SaveNote(ctx, sessionID, actor.UserID, content)
}

// GetNote returns the notes of the student, during or after the class.
func (s *Service) GetNote(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (domain.LiveClassroomNote, error) {
	if _, err := s.studentRoom(ctx, actor, classID, sessionID); err != nil {
		return domain.LiveClassroomNote{}, err
	}
	return s.repo.FindNote(ctx, sessionID, actor.UserID)
}

// Connection is who connects to the realtime channel of the room, and as what. Admission is the situation of a student in the waiting
// room; who runs the room has none.
type Connection struct {
	Session    domain.LiveClassroomSession
	Controller bool
	Admission  string
}

// Connect says whether the actor may connect to the open room of the class: the owner teacher or an administrator control it; a student
// with an active enrollment watches.
func (s *Service) Connect(ctx context.Context, actor Actor, classID uuid.UUID) (Connection, error) {
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return Connection{}, err
	}
	session, err := s.repo.FindActiveSession(ctx, classID)
	if err != nil {
		return Connection{}, err
	}
	conn := Connection{Session: session, Controller: isTeacherSide(actor.Role)}
	if !conn.Controller {
		// A student who comes in for the first time waits; the decision of the teacher outlives the connection (SPEC-054 RN-01, RN-02).
		a, err := s.repo.FindAdmission(ctx, session.ID, actor.UserID)
		if err == domain.ErrAdmissionNotFound {
			a, err = s.repo.UpsertAdmission(ctx, session.ID, actor.UserID, domain.AdmissionWaiting, s.now(), nil)
		}
		if err != nil {
			return Connection{}, err
		}
		conn.Admission = a.Status
	}
	return conn, nil
}

// Admissions are who waits to come in and who is already in, in the order of the requests.
type Admissions struct {
	Waiting  []domain.AdmissionEntry
	Admitted []domain.AdmissionEntry
}

// Admissions returns the waiting room and the admitted of the room.
func (s *Service) Admissions(ctx context.Context, sessionID uuid.UUID) (Admissions, error) {
	entries, err := s.repo.ListAdmissions(ctx, sessionID)
	if err != nil {
		return Admissions{}, err
	}
	out := Admissions{Waiting: []domain.AdmissionEntry{}, Admitted: []domain.AdmissionEntry{}}
	for _, e := range entries {
		if e.Status == domain.AdmissionAdmitted {
			out.Admitted = append(out.Admitted, e)
		} else {
			out.Waiting = append(out.Waiting, e)
		}
	}
	return out, nil
}

// AdmissionState is the situation of the student in the room.
func (s *Service) AdmissionState(ctx context.Context, sessionID, studentID uuid.UUID) (string, error) {
	a, err := s.repo.FindAdmission(ctx, sessionID, studentID)
	return a.Status, err
}

func (s *Service) requireAdmitted(ctx context.Context, sessionID, studentID uuid.UUID) error {
	a, err := s.repo.FindAdmission(ctx, sessionID, studentID)
	if err == domain.ErrAdmissionNotFound || (err == nil && a.Status != domain.AdmissionAdmitted) {
		return domain.ErrNotAdmitted
	}
	return err
}

// decider returns the open room when the actor runs its class: the owner teacher or an administrator (SPEC-054 RN-02).
func (s *Service) decider(ctx context.Context, actor Actor, sessionID uuid.UUID) (domain.LiveClassroomSession, error) {
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return domain.LiveClassroomSession{}, err
	}
	if _, err := s.writable(ctx, actor, session.ClassID); err != nil {
		return domain.LiveClassroomSession{}, err
	}
	return session, nil
}

// Admit lets a waiting student in. Admitting who is already in changes nothing.
func (s *Service) Admit(ctx context.Context, actor Actor, sessionID, studentID uuid.UUID) (Admissions, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return Admissions{}, err
	}
	a, err := s.repo.FindAdmission(ctx, sessionID, studentID)
	if err != nil {
		return Admissions{}, err
	}
	switch a.Status {
	case domain.AdmissionWaiting:
		if _, err := s.repo.UpsertAdmission(ctx, sessionID, studentID, domain.AdmissionAdmitted, s.now(), &actor.UserID); err != nil {
			return Admissions{}, err
		}
	case domain.AdmissionRemoved:
		return Admissions{}, domain.ErrAdmissionNotFound
	}
	return s.Admissions(ctx, sessionID)
}

// AdmitAll lets in everybody who waits, and returns who they are.
func (s *Service) AdmitAll(ctx context.Context, actor Actor, sessionID uuid.UUID) ([]uuid.UUID, Admissions, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return nil, Admissions{}, err
	}
	ids, err := s.repo.AdmitAllWaiting(ctx, sessionID, s.now(), &actor.UserID)
	if err != nil {
		return nil, Admissions{}, err
	}
	adm, err := s.Admissions(ctx, sessionID)
	return ids, adm, err
}

// Remove refuses a waiting student or takes an admitted one out of the room. He only comes back by asking again.
func (s *Service) Remove(ctx context.Context, actor Actor, sessionID, studentID uuid.UUID) (Admissions, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return Admissions{}, err
	}
	a, err := s.repo.FindAdmission(ctx, sessionID, studentID)
	if err != nil {
		return Admissions{}, err
	}
	if a.Status == domain.AdmissionRemoved {
		return Admissions{}, domain.ErrAdmissionNotFound
	}
	if _, err := s.repo.UpsertAdmission(ctx, sessionID, studentID, domain.AdmissionRemoved, s.now(), &actor.UserID); err != nil {
		return Admissions{}, err
	}
	return s.Admissions(ctx, sessionID)
}

// RequestAgain puts a removed student back in the waiting room, and returns his situation. Whoever waits or is admitted keeps it.
func (s *Service) RequestAgain(ctx context.Context, sessionID, studentID uuid.UUID) (string, error) {
	if _, err := s.activeSession(ctx, sessionID); err != nil {
		return "", err
	}
	a, err := s.repo.FindAdmission(ctx, sessionID, studentID)
	if err != nil && err != domain.ErrAdmissionNotFound {
		return "", err
	}
	if err == nil && a.Status != domain.AdmissionRemoved {
		return a.Status, nil
	}
	a, err = s.repo.UpsertAdmission(ctx, sessionID, studentID, domain.AdmissionWaiting, s.now(), nil)
	return a.Status, err
}

// ChangeSlide saves the slide the teacher moved to, drops the strokes of the one he left and puts the scroll of the slide back to the top
// (SPEC-057).
func (s *Service) ChangeSlide(ctx context.Context, sessionID uuid.UUID, slide int) error {
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return err
	}
	pages := 0
	if session.DeckID != nil {
		deck, err := s.repo.FindDeck(ctx, *session.DeckID)
		if err != nil {
			return err
		}
		pages = deck.PageCount
	}
	if !domain.ValidSlide(slide, pages) {
		return domain.ErrInvalidSlide
	}
	session.CurrentSlide = slide
	if err := s.repo.SaveSession(ctx, &session); err != nil {
		return err
	}
	s.live.clearDrawings(sessionID)
	s.live.resetScroll(sessionID, domain.PaneSlide)
	return nil
}

// SwitchMode saves the mode of the room; the module mode needs a module the teacher can use (SPEC-054 RN-06). Going back to the slides
// keeps the module of the lesson; choosing another module drops the block in focus and puts the scroll of the material back to the top
// (SPEC-057).
func (s *Service) SwitchMode(ctx context.Context, actor Actor, sessionID uuid.UUID, mode string, moduleID *uuid.UUID) error {
	if !domain.ValidMode(mode) {
		return domain.ErrInvalidMode
	}
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return err
	}
	if mode == domain.ModeModule {
		if moduleID == nil {
			return domain.ErrModuleNotFound
		}
		if err := s.checkModule(ctx, actor, *moduleID); err != nil {
			return err
		}
		if session.ActiveModuleID == nil || *session.ActiveModuleID != *moduleID {
			s.live.setFocus(sessionID, "")
			s.live.resetScroll(sessionID, domain.PaneMaterial)
		}
		session.ActiveModuleID = moduleID
	}
	session.DisplayMode = mode
	return s.repo.SaveSession(ctx, &session)
}

func (s *Service) checkModule(ctx context.Context, actor Actor, moduleID uuid.UUID) error {
	if s.modules != nil {
		return s.modules.Available(ctx, actor, moduleID)
	}
	ok, err := s.repo.ModuleExists(ctx, moduleID)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrModuleNotFound
	}
	return nil
}

// FocusModuleBlock keeps the block of the module that the teacher put in focus, for who comes in later.
func (s *Service) FocusModuleBlock(ctx context.Context, sessionID uuid.UUID, blockID string) error {
	if len(blockID) > domain.MaxBlockIDLength {
		return domain.ErrInvalidBlock
	}
	if _, err := s.activeSession(ctx, sessionID); err != nil {
		return err
	}
	s.live.setFocus(sessionID, blockID)
	return nil
}

// ModuleOfRoom returns the module the open room of the class chose, for its teacher and for its admitted students. It is the only way
// a student reads a module that is private to another class (SPEC-054 RN-07).
func (s *Service) ModuleOfRoom(ctx context.Context, actor Actor, classID uuid.UUID) (ModuleView, error) {
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return ModuleView{}, err
	}
	session, err := s.repo.FindActiveSession(ctx, classID)
	if err == domain.ErrSessionNotFound {
		return ModuleView{}, domain.ErrNoActiveSession
	}
	if err != nil {
		return ModuleView{}, err
	}
	if actor.Role == authn.RoleStudent {
		if err := s.requireAdmitted(ctx, session.ID, actor.UserID); err != nil {
			if err == domain.ErrNotAdmitted {
				return ModuleView{}, domain.ErrForbidden
			}
			return ModuleView{}, err
		}
	}
	if session.ActiveModuleID == nil {
		return ModuleView{}, domain.ErrModuleNotSelected
	}
	if s.modules == nil {
		return ModuleView{}, domain.ErrModuleNotFound
	}
	return s.modules.Read(ctx, *session.ActiveModuleID)
}

// RaiseHand puts the student in the queue and returns it. Only an admitted student raises his hand (SPEC-054 RN-03).
func (s *Service) RaiseHand(ctx context.Context, sessionID, studentID uuid.UUID) ([]domain.HandRaiseEntry, error) {
	if _, err := s.activeSession(ctx, sessionID); err != nil {
		return nil, err
	}
	if err := s.requireAdmitted(ctx, sessionID, studentID); err != nil {
		return nil, err
	}
	if err := s.repo.RaiseHand(ctx, sessionID, studentID, s.now()); err != nil {
		return nil, err
	}
	return s.repo.ListHandRaises(ctx, sessionID)
}

// LowerHand takes the hand of the student out of the queue, by his own will.
func (s *Service) LowerHand(ctx context.Context, sessionID, studentID uuid.UUID) ([]domain.HandRaiseEntry, error) {
	if err := s.repo.ResolveHand(ctx, sessionID, studentID, domain.HandLowered, s.now()); err != nil {
		return nil, err
	}
	return s.repo.ListHandRaises(ctx, sessionID)
}

// ModerateHand is the teacher answering one student, or, without an id, lowering every hand.
func (s *Service) ModerateHand(ctx context.Context, sessionID uuid.UUID, studentID *uuid.UUID) ([]domain.HandRaiseEntry, error) {
	var err error
	if studentID == nil {
		err = s.repo.ResolveAllHands(ctx, sessionID, s.now())
	} else {
		err = s.repo.ResolveHand(ctx, sessionID, *studentID, domain.HandAnswered, s.now())
	}
	if err != nil {
		return nil, err
	}
	return s.repo.ListHandRaises(ctx, sessionID)
}

// RememberDrawing keeps a stroke of the current slide for who comes in later; a clear message empties them.
func (s *Service) RememberDrawing(sessionID uuid.UUID, raw json.RawMessage) {
	s.live.drawing(sessionID, raw)
}

// RememberTerminalScreen keeps the latest screen of the terminal of the teacher for who comes in later; the terminal of the teacher is
// always broadcast (SPEC-055 RN-04, SPEC-056). It lasts until the lesson ends.
func (s *Service) RememberTerminalScreen(sessionID uuid.UUID, screen json.RawMessage) {
	s.live.setScreen(sessionID, screen)
}

// SetStageBlank puts the stage on the black screen or takes it off; it lasts until it is turned off, a new presenter window takes
// over, or the lesson ends (SPEC-055).
func (s *Service) SetStageBlank(sessionID uuid.UUID, on bool) {
	s.live.setBlank(sessionID, on)
}

// SetStageScroll keeps how far the teacher scrolled a pane of the stage, for who comes in later: only the latest of each pane (SPEC-057).
// The caller checked the pane and the range with domain.ValidStageScroll.
func (s *Service) SetStageScroll(sessionID uuid.UUID, pane string, y float64) {
	s.live.setScroll(sessionID, pane, y)
}

// SetStageSplit keeps the divider of the module as the teacher left it (SPEC-057). The caller checked it with domain.ValidStageSplit.
func (s *Service) SetStageSplit(sessionID uuid.UUID, ratio float64) {
	s.live.setSplit(sessionID, ratio)
}

// StageBlank tells whether the stage is on the black screen.
func (s *Service) StageBlank(sessionID uuid.UUID) bool {
	return s.live.isBlank(sessionID)
}
