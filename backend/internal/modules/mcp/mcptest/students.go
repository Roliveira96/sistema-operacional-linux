package mcptest

import (
	"context"
	"strings"
	"sync"

	"github.com/google/uuid"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	studentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	studentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
)

// Students is the test double of the manual student registration: it runs the real normalizers of the
// student domain and refuses a duplicate e-mail or academic id, like the real service (SPEC-041 RN-01, RN-02).
type Students struct {
	mu sync.Mutex
	// Registered lists the requests that created a student, in order.
	Registered []studentservice.RegisterManualRequest
	emails     map[string]bool
	academic   map[string]bool
	// Fail makes the next call return the error.
	Fail error
}

// NewStudents creates an empty double.
func NewStudents() *Students {
	return &Students{emails: map[string]bool{}, academic: map[string]bool{}}
}

// RegisterManual creates a student.
func (s *Students) RegisterManual(_ context.Context, req studentservice.RegisterManualRequest) (studentservice.RegisterManualResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail != nil {
		err := s.Fail
		s.Fail = nil
		return studentservice.RegisterManualResponse{}, err
	}
	ra, err := studentdomain.NormalizeAcademicID(req.AcademicID)
	if err != nil {
		return studentservice.RegisterManualResponse{}, err
	}
	email, err := studentdomain.NormalizeEmail(req.Email)
	if err != nil {
		return studentservice.RegisterManualResponse{}, err
	}
	if s.emails[email] {
		return studentservice.RegisterManualResponse{}, studentdomain.ErrEmailAlreadyRegistered
	}
	if s.academic[ra] {
		return studentservice.RegisterManualResponse{}, studentdomain.ErrAcademicIDAlreadyRegistered
	}
	s.emails[email], s.academic[ra] = true, true
	s.Registered = append(s.Registered, req)
	return studentservice.RegisterManualResponse{ID: uuid.New(), AcademicID: ra, Email: email, EnrollmentStatus: "NOT_ENROLLED"}, nil
}

// Class is a class of the enrollment double.
type Class struct {
	TeacherID uuid.UUID
	Archived  bool
}

// Enrollments is the test double of the batch enrollment: it authorizes like the real service (the owner teacher or an
// administrator) and refuses an archived class (SPEC-041 RN-03 to RN-06).
type Enrollments struct {
	mu      sync.Mutex
	Classes map[uuid.UUID]Class
	// Enrolled has the students enrolled, by class.
	Enrolled map[uuid.UUID][]uuid.UUID
}

// NewEnrollments creates an empty double.
func NewEnrollments() *Enrollments {
	return &Enrollments{Classes: map[uuid.UUID]Class{}, Enrolled: map[uuid.UUID][]uuid.UUID{}}
}

// AddClass stores a class of the teacher.
func (e *Enrollments) AddClass(teacher uuid.UUID) uuid.UUID {
	id := uuid.New()
	e.Classes[id] = Class{TeacherID: teacher}
	return id
}

// EnrollStudents enrolls the students in the class.
func (e *Enrollments) EnrollStudents(_ context.Context, actorID uuid.UUID, actorRole string, classID uuid.UUID, ids []uuid.UUID) (classservice.EnrollStudentsResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	class, ok := e.Classes[classID]
	if !ok {
		return classservice.EnrollStudentsResult{}, classdomain.ErrClassNotFound
	}
	if !strings.EqualFold(actorRole, "ADMIN") && class.TeacherID != actorID {
		return classservice.EnrollStudentsResult{}, classdomain.ErrForbidden
	}
	if class.Archived {
		return classservice.EnrollStudentsResult{}, classdomain.ErrClassArchived
	}
	res := classservice.EnrollStudentsResult{Enrolled: []uuid.UUID{}, AlreadyEnrolled: []uuid.UUID{}, Rejected: []classservice.RejectedStudent{}}
	have := map[uuid.UUID]bool{}
	for _, id := range e.Enrolled[classID] {
		have[id] = true
	}
	for _, id := range ids {
		if have[id] {
			res.AlreadyEnrolled = append(res.AlreadyEnrolled, id)
			continue
		}
		e.Enrolled[classID] = append(e.Enrolled[classID], id)
		res.Enrolled = append(res.Enrolled, id)
	}
	return res, nil
}
