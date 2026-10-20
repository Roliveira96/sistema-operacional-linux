package service_test

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// fakeRepo is an in-memory implementation of service.Repository.
type fakeRepo struct {
	assessments map[uuid.UUID]domain.Assessment
	items       map[uuid.UUID][]domain.Item
	rules       map[uuid.UUID][]domain.DrawRule
	students    map[uuid.UUID][]uuid.UUID
	events      map[uuid.UUID][]domain.Event
	writes      int // how many times an assessment was written (Create or Save)

	// the decisions of the clearance (SPEC-076): by assessment, then by student, one row each
	clearances     map[uuid.UUID]map[uuid.UUID]domain.Clearance
	clearanceSaves int // how many times a batch of decisions was written
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		assessments: map[uuid.UUID]domain.Assessment{},
		items:       map[uuid.UUID][]domain.Item{},
		rules:       map[uuid.UUID][]domain.DrawRule{},
		students:    map[uuid.UUID][]uuid.UUID{},
		events:      map[uuid.UUID][]domain.Event{},
		clearances:  map[uuid.UUID]map[uuid.UUID]domain.Clearance{},
	}
}

func (f *fakeRepo) Create(_ context.Context, a *domain.Assessment, items []domain.Item, rules []domain.DrawRule, students []uuid.UUID, e domain.Event) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	f.writes++
	f.assessments[a.ID] = *a
	f.items[a.ID] = items
	f.rules[a.ID] = rules
	f.students[a.ID] = students
	e.AssessmentID = a.ID
	f.events[a.ID] = append(f.events[a.ID], e)
	return nil
}

func (f *fakeRepo) Find(_ context.Context, id uuid.UUID) (domain.Assessment, error) {
	a, ok := f.assessments[id]
	if !ok || a.DeletedAt.Valid {
		return domain.Assessment{}, domain.ErrAssessmentNotFound
	}
	return a, nil
}

func (f *fakeRepo) Items(_ context.Context, id uuid.UUID) ([]domain.Item, error) {
	return f.items[id], nil
}
func (f *fakeRepo) Rules(_ context.Context, id uuid.UUID) ([]domain.DrawRule, error) {
	return f.rules[id], nil
}
func (f *fakeRepo) StudentIDs(_ context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	return f.students[id], nil
}
func (f *fakeRepo) Events(_ context.Context, id uuid.UUID) ([]domain.Event, error) {
	return f.events[id], nil
}

func (f *fakeRepo) Save(_ context.Context, a *domain.Assessment, rep service.Replacements, e *domain.Event) error {
	f.writes++
	f.assessments[a.ID] = *a
	if rep.Items != nil {
		f.items[a.ID] = *rep.Items
	}
	if rep.Rules != nil {
		f.rules[a.ID] = *rep.Rules
	}
	if rep.Students != nil {
		f.students[a.ID] = *rep.Students
	}
	if e != nil {
		e.AssessmentID = a.ID
		f.events[a.ID] = append(f.events[a.ID], *e)
	}
	return nil
}

func (f *fakeRepo) Clearances(_ context.Context, id uuid.UUID) ([]domain.Clearance, error) {
	var out []domain.Clearance
	for _, c := range f.clearances[id] {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StudentID.String() < out[j].StudentID.String() })
	return out, nil
}

// SaveClearances writes the whole batch and its event, or nothing: one row for each student, the last decision wins.
func (f *fakeRepo) SaveClearances(_ context.Context, id uuid.UUID, rows []domain.Clearance, e domain.Event) error {
	f.clearanceSaves++
	if f.clearances[id] == nil {
		f.clearances[id] = map[uuid.UUID]domain.Clearance{}
	}
	for _, row := range rows {
		row.AssessmentID = id
		f.clearances[id][row.StudentID] = row
	}
	e.AssessmentID = id
	f.events[id] = append(f.events[id], e)
	return nil
}

// SaveNotes writes only the notes: it touches neither updated_by nor updated_at and writes no event (RN-13).
func (f *fakeRepo) SaveNotes(_ context.Context, id uuid.UUID, notes *string) error {
	a := f.assessments[id]
	a.TeacherPrivateNotes = notes
	f.assessments[id] = a
	return nil
}

func (f *fakeRepo) ListByClass(_ context.Context, classID uuid.UUID) ([]domain.Assessment, error) {
	var out []domain.Assessment
	for _, a := range f.assessments {
		if a.ClassID == classID && !a.DeletedAt.Valid {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartsAt.After(out[j].StartsAt) })
	return out, nil
}

// ListInRange gives the assessments whose period crosses [from, to).
func (f *fakeRepo) ListInRange(_ context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.Assessment, error) {
	var out []domain.Assessment
	for _, a := range f.assessments {
		if a.DeletedAt.Valid || !contains(classIDs, a.ClassID) {
			continue
		}
		if a.StartsAt.Before(to) && a.EndsAt.After(from) {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartsAt.Before(out[j].StartsAt) })
	return out, nil
}

func (f *fakeRepo) HasActiveForLesson(_ context.Context, lessonID uuid.UUID) (bool, error) {
	for _, a := range f.assessments {
		if a.ClassSessionID != nil && *a.ClassSessionID == lessonID && a.Status == domain.StatusScheduled && !a.DeletedAt.Valid {
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeRepo) InScheduledManual(_ context.Context, questionID uuid.UUID) (bool, error) {
	for id, list := range f.items {
		a := f.assessments[id]
		if a.Status != domain.StatusScheduled || a.DeletedAt.Valid {
			continue
		}
		for _, it := range list {
			if it.QuestionID == questionID {
				return true, nil
			}
		}
	}
	return false, nil
}

func (f *fakeRepo) DrawDemand(_ context.Context, moduleID uuid.UUID) (map[domain.Difficulty]int, error) {
	out := map[domain.Difficulty]int{}
	for id, list := range f.rules {
		a := f.assessments[id]
		if a.ModuleID != moduleID || a.Status != domain.StatusScheduled || a.DeletedAt.Valid {
			continue
		}
		for _, r := range list {
			if r.Quantity > out[r.Difficulty] {
				out[r.Difficulty] = r.Quantity
			}
		}
	}
	return out, nil
}

func contains(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// ---- the ports of the other modules ----

type fakeClasses struct {
	classes map[uuid.UUID]service.ClassInfo
}

func (f *fakeClasses) Class(_ context.Context, id uuid.UUID) (service.ClassInfo, error) {
	c, ok := f.classes[id]
	if !ok {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return c, nil
}

// fakeStudents holds the students with an ACTIVE enrollment, by class.
type fakeStudents struct {
	active map[uuid.UUID][]service.Student
}

func (f *fakeStudents) ActiveStudents(_ context.Context, classID uuid.UUID) ([]service.Student, error) {
	return f.active[classID], nil
}

func (f *fakeStudents) StudentClassIDs(_ context.Context, studentID uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for classID, list := range f.active {
		for _, s := range list {
			if s.ID == studentID {
				out = append(out, classID)
			}
		}
	}
	return out, nil
}

func (f *fakeStudents) enroll(classID uuid.UUID, s service.Student) {
	f.active[classID] = append(f.active[classID], s)
}

func (f *fakeStudents) leave(classID, studentID uuid.UUID) {
	var kept []service.Student
	for _, s := range f.active[classID] {
		if s.ID != studentID {
			kept = append(kept, s)
		}
	}
	f.active[classID] = kept
}

type fakeLessons struct {
	lessons map[uuid.UUID]service.Lesson
	asked   int
}

func (f *fakeLessons) Lesson(_ context.Context, id uuid.UUID) (service.Lesson, error) {
	f.asked++
	l, ok := f.lessons[id]
	if !ok {
		return service.Lesson{}, domain.ErrSessionNotFound
	}
	return l, nil
}

// fakeModules knows which module is assigned to which class.
type fakeModules struct {
	assigned map[[2]uuid.UUID]service.Module
}

func (f *fakeModules) ModuleOfClass(_ context.Context, classID, moduleID uuid.UUID) (service.Module, bool, error) {
	m, ok := f.assigned[[2]uuid.UUID{classID, moduleID}]
	return m, ok, nil
}

// fakeQuestions is the bank: Eligible answers only for the questions that are published, in the assessment and not deleted.
type fakeQuestions struct {
	bank map[uuid.UUID]bankQuestion
}

type bankQuestion struct {
	service.QuestionContent
	ModuleID  uuid.UUID
	Published bool
	In        bool // in_assessment
	Deleted   bool
}

func (b bankQuestion) eligible(moduleID uuid.UUID) bool {
	return b.ModuleID == moduleID && b.Published && b.In && !b.Deleted
}

func (f *fakeQuestions) Eligible(_ context.Context, moduleID uuid.UUID, ids []uuid.UUID) ([]service.Question, error) {
	var out []service.Question
	for _, id := range ids {
		if q, ok := f.bank[id]; ok && q.eligible(moduleID) {
			out = append(out, q.Question)
		}
	}
	return out, nil
}

func (f *fakeQuestions) Pool(_ context.Context, filter service.QuestionFilter) (service.QuestionPage, error) {
	page := service.QuestionPage{Stock: map[domain.Difficulty]int{}}
	for _, q := range f.bank {
		if !q.eligible(filter.ModuleID) {
			continue
		}
		page.Stock[q.Difficulty]++
		if filter.Difficulty != "" && q.Difficulty != filter.Difficulty {
			continue
		}
		page.Items = append(page.Items, q.Question)
	}
	sort.Slice(page.Items, func(i, j int) bool { return page.Items[i].Title < page.Items[j].Title })
	page.Total = len(page.Items)
	return page, nil
}

func (f *fakeQuestions) Contents(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]service.QuestionContent, error) {
	out := map[uuid.UUID]service.QuestionContent{}
	for _, id := range ids {
		if q, ok := f.bank[id]; ok {
			out[id] = q.QuestionContent
		}
	}
	return out, nil
}

// Sample draws, in a fixed order, n questions of the level (a real bank draws at random).
func (f *fakeQuestions) Sample(_ context.Context, moduleID uuid.UUID, level domain.Difficulty, n int) ([]service.QuestionContent, error) {
	var all []service.QuestionContent
	for _, q := range f.bank {
		if q.eligible(moduleID) && q.Difficulty == level {
			all = append(all, q.QuestionContent)
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Title < all[j].Title })
	if n > len(all) {
		n = len(all)
	}
	return all[:n], nil
}

// fakeAttempts says which students already started the attempt (SPEC-076 RN-07).
type fakeAttempts struct{ started map[[2]uuid.UUID]bool }

func (f *fakeAttempts) HasStarted(_ context.Context, assessmentID, studentID uuid.UUID) (bool, error) {
	return f.started[[2]uuid.UUID{assessmentID, studentID}], nil
}

// fakeHomologation answers whether an assessment has homologated grades.
type fakeHomologation struct{ homologated map[uuid.UUID]bool }

func (f *fakeHomologation) HasHomologated(_ context.Context, id uuid.UUID) (bool, error) {
	return f.homologated[id], nil
}

// fakeUsers gives the names of the teachers and administrators who made a change.
type fakeUsers struct{ names map[uuid.UUID]string }

func (f *fakeUsers) Names(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	for _, id := range ids {
		if n, ok := f.names[id]; ok {
			out[id] = n
		}
	}
	return out, nil
}
