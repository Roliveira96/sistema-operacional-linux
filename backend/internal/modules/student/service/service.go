// Package service implements student onboarding, manual registration, batch CSV processing, and profile management (SPEC-002).
package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"strings"
	"time"

	_ "golang.org/x/image/webp"

	"github.com/google/uuid"

	authdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

// PasswordHasher abstracts password hashing and verification.
type PasswordHasher interface {
	Hash(password string) (string, error)
	Verify(password, hash string) bool
}

// ObjectStorage abstracts storage operations for avatars.
type ObjectStorage interface {
	PutObject(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) error
	GetObjectURL(objectKey string) string
}

// MailQueue abstracts mail dispatching.
type MailQueue interface {
	Enqueue(msg mailer.Message) error
}

// StudentRepository defines persistence operations needed by the student service.
type StudentRepository interface {
	GetProfileByUserID(ctx context.Context, userID uuid.UUID) (*domain.StudentProfile, error)
	UpsertProfile(ctx context.Context, p *domain.StudentProfile) error
	ListStudents(ctx context.Context, page, perPage int, search string) ([]domain.StudentSummary, int64, error)
	FindUserByAcademicID(ctx context.Context, academicID string) (*userdomain.User, error)
	FindUserByEmail(ctx context.Context, email string) (*userdomain.User, error)
	FindClassByID(ctx context.Context, classID uuid.UUID) (*classdomain.ClassGroup, error)
	FindClassByInviteToken(ctx context.Context, token string) (*classdomain.ClassGroup, error)
	FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (*classdomain.Enrollment, error)
	CreateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error
	UpdateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error
}

// Service manages student onboarding, profiles and membership.
type Service struct {
	repo    StudentRepository
	users   *userservice.Service
	storage ObjectStorage
	hasher  PasswordHasher
	mailer  MailQueue
	now     func() time.Time
}

// Deps holds dependencies for the student service.
type Deps struct {
	Repo    StudentRepository
	Users   *userservice.Service
	Storage ObjectStorage
	Hasher  PasswordHasher
	Mailer  MailQueue
	Now     func() time.Time
}

// New creates a new student service.
func New(deps Deps) *Service {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		repo:    deps.Repo,
		users:   deps.Users,
		storage: deps.Storage,
		hasher:  deps.Hasher,
		mailer:  deps.Mailer,
		now:     now,
	}
}

// RegisterManualRequest represents input for manual student creation (RN-03).
type RegisterManualRequest struct {
	AcademicID   string     `json:"academicId"`
	Email        string     `json:"email"`
	Name         *string    `json:"name"`
	Whatsapp     *string    `json:"whatsapp"`
	Discord      *string    `json:"discord"`
	ClassGroupID *uuid.UUID `json:"classGroupId"`
}

// RegisterManualResponse returns newly registered student information.
type RegisterManualResponse struct {
	ID               uuid.UUID `json:"id"`
	AcademicID       string    `json:"academicId"`
	Email            string    `json:"email"`
	EnrollmentStatus string    `json:"enrollmentStatus"`
	CreatedAt        time.Time `json:"createdAt"`
}

// RegisterManual creates a student user manually by teacher or admin (RN-03).
func (s *Service) RegisterManual(ctx context.Context, req RegisterManualRequest) (RegisterManualResponse, error) {
	normRA, err := domain.NormalizeAcademicID(req.AcademicID)
	if err != nil {
		return RegisterManualResponse{}, err
	}

	normEmail, err := domain.NormalizeEmail(req.Email)
	if err != nil {
		return RegisterManualResponse{}, err
	}

	if req.ClassGroupID != nil {
		if _, err := s.repo.FindClassByID(ctx, *req.ClassGroupID); err != nil {
			return RegisterManualResponse{}, err
		}
	}

	// Uniqueness checks (RN-02)
	existingUser, err := s.repo.FindUserByEmail(ctx, normEmail)
	if err != nil {
		return RegisterManualResponse{}, err
	}
	if existingUser != nil {
		return RegisterManualResponse{}, domain.ErrEmailAlreadyRegistered
	}

	existingRA, err := s.repo.FindUserByAcademicID(ctx, normRA)
	if err != nil {
		return RegisterManualResponse{}, err
	}
	if existingRA != nil {
		return RegisterManualResponse{}, domain.ErrAcademicIDAlreadyRegistered
	}

	var trimmedName *string
	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		n := strings.TrimSpace(*req.Name)
		trimmedName = &n
	}

	u := userdomain.User{
		Name:               trimmedName,
		Email:              normEmail,
		AcademicID:         &normRA,
		Role:               userdomain.RoleStudent,
		Status:             userdomain.StatusActive,
		MustChangePassword: false,
	}

	if err := s.users.Create(ctx, &u); err != nil {
		if errors.Is(err, userdomain.ErrEmailTaken) {
			return RegisterManualResponse{}, domain.ErrEmailAlreadyRegistered
		}
		if errors.Is(err, userdomain.ErrAcademicIDTaken) {
			return RegisterManualResponse{}, domain.ErrAcademicIDAlreadyRegistered
		}
		return RegisterManualResponse{}, err
	}

	if req.Whatsapp != nil || req.Discord != nil {
		p := domain.StudentProfile{
			UserID:   u.ID,
			Whatsapp: req.Whatsapp,
			Discord:  req.Discord,
		}
		if err := s.repo.UpsertProfile(ctx, &p); err != nil {
			return RegisterManualResponse{}, fmt.Errorf("create student profile: %w", err)
		}
	}

	enrollmentStatus := "NOT_ENROLLED"
	if req.ClassGroupID != nil {
		now := s.now()
		enrollment := classdomain.Enrollment{
			ClassID:     *req.ClassGroupID,
			UserID:      u.ID,
			Status:      classdomain.EnrollmentActive,
			Origin:      classdomain.OriginDirectByTeacher,
			RequestedAt: now,
			DecidedAt:   &now,
		}
		if err := s.repo.CreateEnrollment(ctx, &enrollment); err != nil {
			return RegisterManualResponse{}, fmt.Errorf("enroll student in class: %w", err)
		}
		enrollmentStatus = string(classdomain.EnrollmentActive)
	}

	if s.mailer != nil {
		_ = s.mailer.Enqueue(mailer.Message{
			To:       []string{u.Email},
			Subject:  "Bem-vindo à plataforma de Sistemas Operacionais",
			TextBody: "Sua conta de estudante foi criada. Acesse a plataforma e defina sua senha.",
		})
	}

	return RegisterManualResponse{
		ID:               u.ID,
		AcademicID:       normRA,
		Email:            u.Email,
		EnrollmentStatus: enrollmentStatus,
		CreatedAt:        u.CreatedAt,
	}, nil
}

// ImportCSV processes batch student onboarding from CSV in streaming (RN-04).
func (s *Service) ImportCSV(ctx context.Context, classGroupID *uuid.UUID, r io.Reader) (domain.CSVImportResult, error) {
	if classGroupID != nil {
		if _, err := s.repo.FindClassByID(ctx, *classGroupID); err != nil {
			return domain.CSVImportResult{}, err
		}
	}

	buf, err := io.ReadAll(io.LimitReader(r, domain.MaxCSVFileSize+1))
	if err != nil {
		return domain.CSVImportResult{}, fmt.Errorf("read csv: %w", err)
	}
	if len(buf) > domain.MaxCSVFileSize {
		return domain.CSVImportResult{}, domain.ErrCSVFileTooLarge
	}
	if len(bytes.TrimSpace(buf)) == 0 {
		return domain.CSVImportResult{}, domain.ErrInvalidCSV
	}

	// Detect delimiter (; or ,)
	delim := rune(',')
	firstLine := string(buf)
	if idx := strings.IndexAny(firstLine, "\r\n"); idx != -1 {
		firstLine = firstLine[:idx]
	}
	if strings.Count(firstLine, ";") > strings.Count(firstLine, ",") {
		delim = ';'
	}

	csvReader := csv.NewReader(bytes.NewReader(buf))
	csvReader.Comma = delim
	csvReader.LazyQuotes = true
	csvReader.TrimLeadingSpace = true

	headers, err := csvReader.Read()
	if err != nil {
		return domain.CSVImportResult{}, domain.ErrInvalidCSV
	}

	emailIdx := -1
	raIdx := -1
	nameIdx := -1

	for i, h := range headers {
		clean := strings.ToLower(strings.TrimSpace(h))
		clean = strings.ReplaceAll(clean, "-", "_")
		clean = strings.ReplaceAll(clean, " ", "_")
		if clean == "email" || clean == "e_mail" {
			emailIdx = i
		} else if clean == "academic_id" || clean == "academicid" || clean == "ra" || clean == "matricula" {
			raIdx = i
		} else if clean == "name" || clean == "nome" {
			nameIdx = i
		}
	}

	if emailIdx == -1 || raIdx == -1 {
		return domain.CSVImportResult{}, domain.ErrInvalidCSV
	}

	result := domain.CSVImportResult{
		Errors: make([]domain.CSVRowError, 0),
	}

	lineNum := 1
	for {
		record, err := csvReader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		lineNum++
		if err != nil {
			result.TotalRows++
			result.Errors = append(result.Errors, domain.CSVRowError{
				Line:   lineNum,
				Reason: "Linha malformada ou formato CSV incorreto",
			})
			continue
		}

		// Check if record is completely empty
		allEmpty := true
		for _, col := range record {
			if strings.TrimSpace(col) != "" {
				allEmpty = false
				break
			}
		}
		if allEmpty {
			continue
		}

		result.TotalRows++
		if result.TotalRows > domain.MaxCSVRows {
			result.Errors = append(result.Errors, domain.CSVRowError{
				Line:   lineNum,
				Reason: "Limite máximo de 2000 linhas excedido",
			})
			continue
		}

		rawEmail := ""
		if emailIdx < len(record) {
			rawEmail = record[emailIdx]
		}
		rawRA := ""
		if raIdx < len(record) {
			rawRA = record[raIdx]
		}
		rawName := ""
		if nameIdx != -1 && nameIdx < len(record) {
			rawName = strings.TrimSpace(record[nameIdx])
		}

		normEmail, err := domain.NormalizeEmail(rawEmail)
		if err != nil {
			result.Errors = append(result.Errors, domain.CSVRowError{
				Line:   lineNum,
				Reason: "E-mail inválido ou ausente",
			})
			continue
		}

		normRA, err := domain.NormalizeAcademicID(rawRA)
		if err != nil {
			result.Errors = append(result.Errors, domain.CSVRowError{
				Line:   lineNum,
				Reason: "RA inválido (deve conter 7 dígitos)",
			})
			continue
		}

		// Check database for existing users by email or academic_id
		userByEmail, err := s.repo.FindUserByEmail(ctx, normEmail)
		if err != nil {
			result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
			continue
		}

		userByRA, err := s.repo.FindUserByAcademicID(ctx, normRA)
		if err != nil {
			result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
			continue
		}

		// Conflict: email and RA point to distinct users
		if userByEmail != nil && userByRA != nil && userByEmail.ID != userByRA.ID {
			result.Errors = append(result.Errors, domain.CSVRowError{
				Line:   lineNum,
				Reason: "Conflito: e-mail e RA já estão cadastrados para usuários distintos",
			})
			continue
		}

		var targetUser *userdomain.User
		if userByEmail != nil {
			targetUser = userByEmail
		} else if userByRA != nil {
			targetUser = userByRA
		}

		if targetUser == nil {
			// Brand new student user
			var namePtr *string
			if rawName != "" {
				namePtr = &rawName
			}
			newU := userdomain.User{
				Name:               namePtr,
				Email:              normEmail,
				AcademicID:         &normRA,
				Role:               userdomain.RoleStudent,
				Status:             userdomain.StatusActive,
				MustChangePassword: false,
			}
			if err := s.users.Create(ctx, &newU); err != nil {
				result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
				continue
			}
			targetUser = &newU
			result.Created++

			if classGroupID != nil {
				now := s.now()
				enr := classdomain.Enrollment{
					ClassID:     *classGroupID,
					UserID:      targetUser.ID,
					Status:      classdomain.EnrollmentActive,
					Origin:      classdomain.OriginCSVImport,
					RequestedAt: now,
					DecidedAt:   &now,
				}
				if err := s.repo.CreateEnrollment(ctx, &enr); err != nil {
					result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
					continue
				}
				result.Enrolled++
			}
		} else {
			// User already exists
			if classGroupID != nil {
				existingEnr, err := s.repo.FindEnrollment(ctx, *classGroupID, targetUser.ID)
				if err != nil {
					result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
					continue
				}
				if existingEnr != nil && (existingEnr.Status == classdomain.EnrollmentActive || existingEnr.Status == classdomain.EnrollmentPendingModeration) {
					result.AlreadyEnrolled++
				} else if existingEnr != nil {
					// Reinstate as active
					now := s.now()
					existingEnr.Status = classdomain.EnrollmentActive
					existingEnr.Origin = classdomain.OriginCSVImport
					existingEnr.DecidedAt = &now
					if err := s.repo.UpdateEnrollment(ctx, existingEnr); err != nil {
						result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
						continue
					}
					result.Enrolled++
				} else {
					// Create new active enrollment
					now := s.now()
					enr := classdomain.Enrollment{
						ClassID:     *classGroupID,
						UserID:      targetUser.ID,
						Status:      classdomain.EnrollmentActive,
						Origin:      classdomain.OriginCSVImport,
						RequestedAt: now,
						DecidedAt:   &now,
					}
					if err := s.repo.CreateEnrollment(ctx, &enr); err != nil {
						result.Errors = append(result.Errors, domain.CSVRowError{Line: lineNum, Reason: err.Error()})
						continue
					}
					result.Enrolled++
				}
			}
		}
	}

	return result, nil
}

// JoinByInviteRequest represents public student self-registration via invite link (RN-05).
type JoinByInviteRequest struct {
	AcademicID string  `json:"academicId"`
	Email      string  `json:"email"`
	Name       string  `json:"name"`
	Password   string  `json:"password"`
	Whatsapp   *string `json:"whatsapp"`
	Discord    *string `json:"discord"`
}

// JoinByInviteResponse returns the newly created account status and moderation state.
type JoinByInviteResponse struct {
	UserID           uuid.UUID `json:"userId"`
	AccountStatus    string    `json:"accountStatus"`
	EnrollmentStatus string    `json:"enrollmentStatus"`
}

// JoinByInvite handles student self-registration via class invite link (RN-05).
func (s *Service) JoinByInvite(ctx context.Context, token string, req JoinByInviteRequest) (JoinByInviteResponse, error) {
	class, err := s.repo.FindClassByInviteToken(ctx, token)
	if err != nil {
		return JoinByInviteResponse{}, domain.ErrInviteNotFound
	}

	if !class.IsInviteLinkValid(s.now()) {
		return JoinByInviteResponse{}, domain.ErrInviteExpired
	}

	trimmedName := strings.TrimSpace(req.Name)
	if trimmedName == "" {
		return JoinByInviteResponse{}, errors.New("name is required")
	}

	normRA, err := domain.NormalizeAcademicID(req.AcademicID)
	if err != nil {
		return JoinByInviteResponse{}, err
	}

	normEmail, err := domain.NormalizeEmail(req.Email)
	if err != nil {
		return JoinByInviteResponse{}, err
	}

	// Validate password policy
	if err := authdomain.CheckPassword(req.Password, normEmail, normRA); err != nil {
		return JoinByInviteResponse{}, err
	}

	// Uniqueness checks (RN-02)
	existingEmail, err := s.repo.FindUserByEmail(ctx, normEmail)
	if err != nil {
		return JoinByInviteResponse{}, err
	}
	if existingEmail != nil {
		return JoinByInviteResponse{}, domain.ErrEmailAlreadyRegistered
	}

	existingRA, err := s.repo.FindUserByAcademicID(ctx, normRA)
	if err != nil {
		return JoinByInviteResponse{}, err
	}
	if existingRA != nil {
		return JoinByInviteResponse{}, domain.ErrAcademicIDAlreadyRegistered
	}

	hashed, err := s.hasher.Hash(req.Password)
	if err != nil {
		return JoinByInviteResponse{}, fmt.Errorf("hash password: %w", err)
	}

	u := userdomain.User{
		Name:               &trimmedName,
		Email:              normEmail,
		AcademicID:         &normRA,
		PasswordHash:       &hashed,
		Role:               userdomain.RoleStudent,
		Status:             userdomain.StatusActive,
		MustChangePassword: false,
	}

	if err := s.users.Create(ctx, &u); err != nil {
		if errors.Is(err, userdomain.ErrEmailTaken) {
			return JoinByInviteResponse{}, domain.ErrEmailAlreadyRegistered
		}
		if errors.Is(err, userdomain.ErrAcademicIDTaken) {
			return JoinByInviteResponse{}, domain.ErrAcademicIDAlreadyRegistered
		}
		return JoinByInviteResponse{}, err
	}

	if req.Whatsapp != nil || req.Discord != nil {
		p := domain.StudentProfile{
			UserID:   u.ID,
			Whatsapp: req.Whatsapp,
			Discord:  req.Discord,
		}
		_ = s.repo.UpsertProfile(ctx, &p)
	}

	now := s.now()
	enr := classdomain.Enrollment{
		ClassID:     class.ID,
		UserID:      u.ID,
		Status:      classdomain.EnrollmentPendingModeration,
		Origin:      classdomain.OriginInviteLink,
		RequestedAt: now,
	}
	if err := s.repo.CreateEnrollment(ctx, &enr); err != nil {
		return JoinByInviteResponse{}, fmt.Errorf("create enrollment: %w", err)
	}

	return JoinByInviteResponse{
		UserID:           u.ID,
		AccountStatus:    string(userdomain.StatusActive),
		EnrollmentStatus: string(classdomain.EnrollmentPendingModeration),
	}, nil
}

// UpdateAvatar uploads, validates and persists an avatar image for a student (RN-08).
func (s *Service) UpdateAvatar(ctx context.Context, userID uuid.UUID, r io.Reader, size int64, contentType string) (string, error) {
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return "", domain.ErrStudentNotFound
	}
	if u.Role != userdomain.RoleStudent {
		return "", domain.ErrNotAStudent
	}

	if size > domain.MaxAvatarFileSize {
		return "", domain.ErrImageTooLarge
	}

	ct := strings.ToLower(strings.TrimSpace(contentType))
	validFormat := false
	ext := "jpg"
	switch {
	case strings.Contains(ct, "jpeg") || strings.Contains(ct, "jpg"):
		validFormat = true
		ext = "jpg"
	case strings.Contains(ct, "png"):
		validFormat = true
		ext = "png"
	case strings.Contains(ct, "webp"):
		validFormat = true
		ext = "webp"
	}
	if !validFormat {
		return "", domain.ErrUnsupportedImageFormat
	}

	buf, err := io.ReadAll(io.LimitReader(r, domain.MaxAvatarFileSize+1))
	if err != nil {
		return "", fmt.Errorf("read avatar buffer: %w", err)
	}
	if int64(len(buf)) > domain.MaxAvatarFileSize {
		return "", domain.ErrImageTooLarge
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(buf))
	if err != nil {
		return "", domain.ErrUnsupportedImageFormat
	}

	if cfg.Width < domain.MinAvatarDimension || cfg.Width > domain.MaxAvatarDimension ||
		cfg.Height < domain.MinAvatarDimension || cfg.Height > domain.MaxAvatarDimension {
		return "", domain.ErrImageDimensions
	}

	objectKey := fmt.Sprintf("avatars/%s/%s.%s", userID.String(), uuid.New().String(), ext)
	if s.storage != nil {
		if err := s.storage.PutObject(ctx, objectKey, bytes.NewReader(buf), int64(len(buf)), ct); err != nil {
			return "", fmt.Errorf("storage put object: %w", err)
		}
	}

	p := domain.StudentProfile{
		UserID:          userID,
		AvatarObjectKey: &objectKey,
	}
	if err := s.repo.UpsertProfile(ctx, &p); err != nil {
		return "", fmt.Errorf("update student profile avatar: %w", err)
	}

	url := objectKey
	if s.storage != nil {
		url = s.storage.GetObjectURL(objectKey)
	}
	return url, nil
}

// GetProfile returns the self profile view of a student.
func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (domain.StudentProfileResponse, error) {
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return domain.StudentProfileResponse{}, domain.ErrStudentNotFound
	}
	if u.Role != userdomain.RoleStudent {
		return domain.StudentProfileResponse{}, domain.ErrNotAStudent
	}

	profile, err := s.repo.GetProfileByUserID(ctx, userID)
	if err != nil {
		return domain.StudentProfileResponse{}, err
	}

	academicID := ""
	if u.AcademicID != nil {
		academicID = *u.AcademicID
	}
	name := ""
	if u.Name != nil {
		name = *u.Name
	}

	var avatarURL *string
	var whatsapp *string
	var discord *string
	if profile != nil {
		whatsapp = profile.Whatsapp
		discord = profile.Discord
		if profile.AvatarObjectKey != nil {
			url := *profile.AvatarObjectKey
			if s.storage != nil {
				url = s.storage.GetObjectURL(url)
			}
			avatarURL = &url
		}
	}

	return domain.StudentProfileResponse{
		ID:         u.ID,
		AcademicID: academicID,
		Email:      u.Email,
		Name:       name,
		Whatsapp:   whatsapp,
		Discord:    discord,
		AvatarURL:  avatarURL,
		CreatedAt:  u.CreatedAt,
	}, nil
}

// ListStudentsResponse wraps paginated student summaries.
type ListStudentsResponse struct {
	Items      []domain.StudentSummary `json:"items"`
	TotalCount int64                  `json:"totalCount"`
	Page       int                    `json:"page"`
	PerPage    int                    `json:"perPage"`
}

// ListStudents returns a paginated list of student users with enriched avatar URLs.
func (s *Service) ListStudents(ctx context.Context, page, perPage int, search string) (ListStudentsResponse, error) {
	items, total, err := s.repo.ListStudents(ctx, page, perPage, search)
	if err != nil {
		return ListStudentsResponse{}, err
	}

	if s.storage != nil {
		for i := range items {
			if items[i].AvatarURL != nil && *items[i].AvatarURL != "" {
				url := s.storage.GetObjectURL(*items[i].AvatarURL)
				items[i].AvatarURL = &url
			}
		}
	}

	return ListStudentsResponse{
		Items:      items,
		TotalCount: total,
		Page:       page,
		PerPage:    perPage,
	}, nil
}
