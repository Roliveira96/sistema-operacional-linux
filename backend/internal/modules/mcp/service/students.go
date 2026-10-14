package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	studentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	studentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
)

// MaxStudentsPerCall is the largest batch of create_students (SPEC-045 RN-01).
const MaxStudentsPerCall = 50

// Students is the manual registration of a student (SPEC-041). The service of the student module satisfies it.
type Students interface {
	RegisterManual(ctx context.Context, req studentservice.RegisterManualRequest) (studentservice.RegisterManualResponse, error)
}

// Enrollments is the batch enrollment of existing students in a class (SPEC-041). It authorizes the actor against the
// class (the owner teacher or an administrator). The service of the classgroup module satisfies it.
type Enrollments interface {
	EnrollStudents(ctx context.Context, actorID uuid.UUID, actorRole string, classID uuid.UUID, studentIDs []uuid.UUID) (classservice.EnrollStudentsResult, error)
}

// WithStudents plugs the registration and enrollment of students in (SPEC-045).
func (s *Service) WithStudents(students Students, enrollments Enrollments) *Service {
	s.students = students
	s.enrollments = enrollments
	return s
}

// StudentInput is one student of the batch.
type StudentInput struct {
	AcademicID string `json:"academicId"`
	Email      string `json:"email"`
	Name       string `json:"name,omitempty"`
}

// CreateStudentsInput is the batch, with the class to enroll them in, if any.
type CreateStudentsInput struct {
	ClassID  string         `json:"classId,omitempty"`
	Students []StudentInput `json:"students"`
}

// CreatedStudent is a student the call created.
type CreatedStudent struct {
	StudentID  uuid.UUID `json:"studentId"`
	AcademicID string    `json:"academicId"`
	Email      string    `json:"email"`
}

// RejectedStudentItem is an item of the batch the service refused (SPEC-045 RN-03).
type RejectedStudentItem struct {
	Index      int    `json:"index"`
	AcademicID string `json:"academicId"`
	Email      string `json:"email"`
	Type       string `json:"type"`
	Detail     string `json:"detail"`
}

// EnrollmentRejected is a student the enrollment refused.
type EnrollmentRejected struct {
	StudentID uuid.UUID `json:"studentId"`
	Reason    string    `json:"reason"`
}

// EnrollmentError is why the whole enrollment was refused (SPEC-045 RN-04).
type EnrollmentError struct {
	Type   string `json:"type"`
	Detail string `json:"detail"`
}

// EnrollmentResult is the outcome of the enrollment in the class.
type EnrollmentResult struct {
	ClassID         uuid.UUID            `json:"classId"`
	Enrolled        int                  `json:"enrolled"`
	AlreadyEnrolled int                  `json:"alreadyEnrolled"`
	Rejected        []EnrollmentRejected `json:"rejected"`
	Error           *EnrollmentError     `json:"error,omitempty"`
}

// CreateStudentsResult is the outcome of the call.
type CreateStudentsResult struct {
	Created    []CreatedStudent      `json:"created"`
	Rejected   []RejectedStudentItem `json:"rejected"`
	Enrollment *EnrollmentResult     `json:"enrollment,omitempty"`
}

func (s *Service) studentsReady() *domain.ToolError {
	if s.students == nil || s.enrollments == nil {
		return domain.NewToolError(http.StatusInternalServerError, domain.TypeInternal, "The registration of students is not available.")
	}
	return nil
}

// studentProblem tells the type of problem of a refused student, the same slugs the REST layer uses (SPEC-045 RN-03).
func studentProblem(err error) (errType, detail string, known bool) {
	switch {
	case errors.Is(err, studentdomain.ErrInvalidAcademicID):
		return "invalid-academic-id", err.Error(), true
	case errors.Is(err, studentdomain.ErrInvalidEmail):
		return "invalid-email", err.Error(), true
	case errors.Is(err, studentdomain.ErrEmailAlreadyRegistered):
		return "email-already-registered", err.Error(), true
	case errors.Is(err, studentdomain.ErrAcademicIDAlreadyRegistered):
		return "academic-id-already-registered", err.Error(), true
	}
	return domain.TypeInternal, "An unexpected error occurred.", false
}

// enrollmentProblem tells why an enrollment was refused as a whole.
func enrollmentProblem(err error) (errType, detail string, known bool) {
	switch {
	case errors.Is(err, classdomain.ErrForbidden):
		return domain.TypeForbidden, err.Error(), true
	case errors.Is(err, classdomain.ErrClassNotFound):
		return "class-not-found", err.Error(), true
	case errors.Is(err, classdomain.ErrClassArchived):
		return "class-archived", err.Error(), true
	case errors.Is(err, classdomain.ErrInvalidEnrollmentBatch):
		return "invalid-enrollment-batch", err.Error(), true
	}
	return domain.TypeInternal, "An unexpected error occurred.", false
}

// CreateStudents registers a batch of students and, with a class, enrolls the ones it created (create_students). It is a write: rate
// limited and recorded in the log with counts and ids, never the academic id, e-mail or name of a student (SPEC-045 RN-05).
func (s *Service) CreateStudents(ctx context.Context, c Caller, in CreateStudentsInput) (out CreateStudentsResult, terr *domain.ToolError) {
	if terr := s.studentsReady(); terr != nil {
		return CreateStudentsResult{}, terr
	}
	if n := len(in.Students); n < 1 || n > MaxStudentsPerCall {
		return CreateStudentsResult{}, invalid("students", itoa(n)+" students", "from 1 to "+itoa(MaxStudentsPerCall)+" students")
	}
	var classID uuid.UUID
	if in.ClassID != "" {
		id, terr := parseID("classId", in.ClassID)
		if terr != nil {
			return CreateStudentsResult{}, terr
		}
		classID = id
	}
	if terr := s.allow(c); terr != nil {
		return CreateStudentsResult{}, terr
	}
	defer func() {
		s.log.Info("mcp write", zap.String("userId", c.UserID.String()), zap.String("tool", domain.ToolCreateStudents),
			zap.String("classId", classID.String()), zap.Int("created", len(out.Created)), zap.Int("rejected", len(out.Rejected)),
			zap.Bool("ok", terr == nil))
	}()

	out = CreateStudentsResult{Created: []CreatedStudent{}, Rejected: []RejectedStudentItem{}}
	for i, st := range in.Students {
		req := studentservice.RegisterManualRequest{AcademicID: st.AcademicID, Email: st.Email}
		if name := strings.TrimSpace(st.Name); name != "" {
			req.Name = &name
		}
		res, err := s.students.RegisterManual(ctx, req)
		if err != nil {
			errType, detail, known := studentProblem(err)
			if !known {
				s.log.Error("mcp create_students failed", zap.String("userId", c.UserID.String()), zap.Error(err))
			}
			out.Rejected = append(out.Rejected, RejectedStudentItem{Index: i, AcademicID: st.AcademicID, Email: st.Email, Type: errType, Detail: detail})
			continue
		}
		out.Created = append(out.Created, CreatedStudent{StudentID: res.ID, AcademicID: res.AcademicID, Email: res.Email})
	}

	if in.ClassID != "" {
		out.Enrollment = s.enroll(ctx, c, classID, out.Created)
	}
	return out, nil
}

// enroll enrolls the created students in the class. A refusal keeps them created and is reported (SPEC-045 RN-04).
func (s *Service) enroll(ctx context.Context, c Caller, classID uuid.UUID, created []CreatedStudent) *EnrollmentResult {
	result := &EnrollmentResult{ClassID: classID, Rejected: []EnrollmentRejected{}}
	if len(created) == 0 {
		return result
	}
	ids := make([]uuid.UUID, len(created))
	for i, st := range created {
		ids[i] = st.StudentID
	}
	res, err := s.enrollments.EnrollStudents(ctx, c.UserID, c.Role, classID, ids)
	if err != nil {
		errType, detail, known := enrollmentProblem(err)
		if !known {
			s.log.Error("mcp create_students enrollment failed", zap.String("userId", c.UserID.String()), zap.Error(err))
		}
		result.Error = &EnrollmentError{Type: errType, Detail: detail}
		return result
	}
	result.Enrolled = len(res.Enrolled)
	result.AlreadyEnrolled = len(res.AlreadyEnrolled)
	for _, r := range res.Rejected {
		result.Rejected = append(result.Rejected, EnrollmentRejected{StudentID: r.StudentID, Reason: r.Reason})
	}
	return result
}
