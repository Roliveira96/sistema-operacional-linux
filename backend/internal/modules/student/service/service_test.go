package service_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

// FakeHasher implements PasswordHasher.
type fakeHasher struct{}

func (fakeHasher) Hash(p string) (string, error) { return "hashed:" + p, nil }
func (fakeHasher) Verify(p, h string) bool       { return h == "hashed:"+p }

// FakeStorage implements ObjectStorage.
type fakeStorage struct {
	objects map[string][]byte
}

func newFakeStorage() *fakeStorage {
	return &fakeStorage{objects: make(map[string][]byte)}
}

func (f *fakeStorage) PutObject(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) error {
	buf, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	f.objects[objectKey] = buf
	return nil
}

func (f *fakeStorage) GetObjectURL(objectKey string) string {
	return "https://cdn.example.com/" + objectKey
}

// FakeUserRepo implements userservice.Repository.
type fakeUserRepo struct {
	users map[uuid.UUID]userdomain.User
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{users: make(map[uuid.UUID]userdomain.User)}
}

func (r *fakeUserRepo) FindByID(ctx context.Context, id uuid.UUID) (userdomain.User, error) {
	u, ok := r.users[id]
	if !ok {
		return userdomain.User{}, userdomain.ErrNotFound
	}
	return u, nil
}

func (r *fakeUserRepo) FindByEmail(ctx context.Context, email string) (userdomain.User, error) {
	for _, u := range r.users {
		if strings.EqualFold(u.Email, email) {
			return u, nil
		}
	}
	return userdomain.User{}, userdomain.ErrNotFound
}

func (r *fakeUserRepo) FindByAcademicID(ctx context.Context, academicID string) (userdomain.User, error) {
	for _, u := range r.users {
		if u.AcademicID != nil && *u.AcademicID == academicID {
			return u, nil
		}
	}
	return userdomain.User{}, userdomain.ErrNotFound
}

func (r *fakeUserRepo) Create(ctx context.Context, u *userdomain.User) error {
	for _, existing := range r.users {
		if strings.EqualFold(existing.Email, u.Email) {
			return userdomain.ErrEmailTaken
		}
		if u.AcademicID != nil && existing.AcademicID != nil && *existing.AcademicID == *u.AcademicID {
			return userdomain.ErrAcademicIDTaken
		}
	}
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	u.CreatedAt = time.Now()
	r.users[u.ID] = *u
	return nil
}

func (r *fakeUserRepo) UpdatePassword(ctx context.Context, id uuid.UUID, hash string, mustChange bool) error {
	u, ok := r.users[id]
	if !ok {
		return userdomain.ErrNotFound
	}
	u.PasswordHash = &hash
	u.MustChangePassword = mustChange
	r.users[id] = u
	return nil
}

// FakeStudentRepo implements service.StudentRepository.
type fakeStudentRepo struct {
	userRepo    *fakeUserRepo
	profiles    map[uuid.UUID]domain.StudentProfile
	classes     map[uuid.UUID]classdomain.ClassGroup
	enrollments map[string]classdomain.Enrollment
}

func newFakeStudentRepo(userRepo *fakeUserRepo) *fakeStudentRepo {
	return &fakeStudentRepo{
		userRepo:    userRepo,
		profiles:    make(map[uuid.UUID]domain.StudentProfile),
		classes:     make(map[uuid.UUID]classdomain.ClassGroup),
		enrollments: make(map[string]classdomain.Enrollment),
	}
}

func (r *fakeStudentRepo) GetProfileByUserID(ctx context.Context, userID uuid.UUID) (*domain.StudentProfile, error) {
	p, ok := r.profiles[userID]
	if !ok {
		return nil, nil
	}
	return &p, nil
}

func (r *fakeStudentRepo) UpsertProfile(ctx context.Context, p *domain.StudentProfile) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	r.profiles[p.UserID] = *p
	return nil
}

func (r *fakeStudentRepo) ListStudents(ctx context.Context, page, perPage int, search string) ([]domain.StudentSummary, int64, error) {
	var items []domain.StudentSummary
	search = strings.ToLower(strings.TrimSpace(search))

	for _, u := range r.userRepo.users {
		if u.Role != userdomain.RoleStudent {
			continue
		}
		name := ""
		if u.Name != nil {
			name = *u.Name
		}
		ra := ""
		if u.AcademicID != nil {
			ra = *u.AcademicID
		}

		if search != "" {
			if !strings.Contains(strings.ToLower(name), search) &&
				!strings.Contains(strings.ToLower(u.Email), search) &&
				!strings.Contains(ra, search) {
				continue
			}
		}

		profile := r.profiles[u.ID]
		items = append(items, domain.StudentSummary{
			ID:                   u.ID,
			AcademicID:           ra,
			Email:                u.Email,
			Name:                 name,
			Whatsapp:             profile.Whatsapp,
			Discord:              profile.Discord,
			AvatarURL:            profile.AvatarObjectKey,
			TotalClassesEnrolled: 0,
			CreatedAt:            u.CreatedAt,
		})
	}
	return items, int64(len(items)), nil
}

func (r *fakeStudentRepo) FindUserByAcademicID(ctx context.Context, academicID string) (*userdomain.User, error) {
	u, err := r.userRepo.FindByAcademicID(ctx, academicID)
	if err != nil {
		return nil, nil
	}
	return &u, nil
}

func (r *fakeStudentRepo) FindUserByEmail(ctx context.Context, email string) (*userdomain.User, error) {
	u, err := r.userRepo.FindByEmail(ctx, email)
	if err != nil {
		return nil, nil
	}
	return &u, nil
}

func (r *fakeStudentRepo) FindClassByID(ctx context.Context, classID uuid.UUID) (*classdomain.ClassGroup, error) {
	c, ok := r.classes[classID]
	if !ok {
		return nil, domain.ErrClassNotFound
	}
	return &c, nil
}

func (r *fakeStudentRepo) FindClassByInviteToken(ctx context.Context, token string) (*classdomain.ClassGroup, error) {
	for _, c := range r.classes {
		if c.InviteLinkToken != nil && *c.InviteLinkToken == token {
			return &c, nil
		}
	}
	return nil, domain.ErrInviteNotFound
}

func (r *fakeStudentRepo) FindEnrollment(ctx context.Context, classID, userID uuid.UUID) (*classdomain.Enrollment, error) {
	key := classID.String() + ":" + userID.String()
	enr, ok := r.enrollments[key]
	if !ok {
		return nil, nil
	}
	return &enr, nil
}

func (r *fakeStudentRepo) CreateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error {
	if enrollment.ID == uuid.Nil {
		enrollment.ID = uuid.New()
	}
	key := enrollment.ClassID.String() + ":" + enrollment.UserID.String()
	r.enrollments[key] = *enrollment
	return nil
}

func (r *fakeStudentRepo) UpdateEnrollment(ctx context.Context, enrollment *classdomain.Enrollment) error {
	key := enrollment.ClassID.String() + ":" + enrollment.UserID.String()
	r.enrollments[key] = *enrollment
	return nil
}

// FakeMailer implements MailQueue.
type fakeMailer struct {
	sent []mailer.Message
}

func (f *fakeMailer) Enqueue(msg mailer.Message) error {
	f.sent = append(f.sent, msg)
	return nil
}

func setupTestService() (*service.Service, *fakeStudentRepo, *fakeUserRepo, *fakeStorage, *fakeMailer) {
	userRepo := newFakeUserRepo()
	userSvc := userservice.New(userRepo)
	studentRepo := newFakeStudentRepo(userRepo)
	storage := newFakeStorage()
	mailer := &fakeMailer{}
	fixedNow := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

	svc := service.New(service.Deps{
		Repo:    studentRepo,
		Users:   userSvc,
		Storage: storage,
		Hasher:  fakeHasher{},
		Mailer:  mailer,
		Now:     func() time.Time { return fixedNow },
	})

	return svc, studentRepo, userRepo, storage, mailer
}

func createTestPNG(width, height int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			img.Set(x, y, color.RGBA{R: 100, G: 200, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func createTestJPEG(width, height int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			img.Set(x, y, color.RGBA{R: 100, G: 200, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestRegisterManual(t *testing.T) {
	svc, studentRepo, _, _, mailer := setupTestService()
	ctx := context.Background()

	t.Run("without class group (CA-01)", func(t *testing.T) {
		name := "Ana Souza"
		res, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "a2345678",
			Email:      "ana@utfpr.edu.br",
			Name:       &name,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.EnrollmentStatus != "NOT_ENROLLED" {
			t.Fatalf("expected NOT_ENROLLED, got %s", res.EnrollmentStatus)
		}
		if res.AcademicID != "2345678" {
			t.Fatalf("expected normalized RA 2345678, got %s", res.AcademicID)
		}
		if len(mailer.sent) == 0 {
			t.Fatalf("expected welcome mail to be enqueued")
		}
	})

	t.Run("with class group (CA-01, CA-02)", func(t *testing.T) {
		classID := uuid.New()
		studentRepo.classes[classID] = classdomain.ClassGroup{
			Name:   "Sistemas Operacionais 2026/2",
			Status: classdomain.ClassStatusActive,
		}

		name := "Bruno Silva"
		res, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID:   "3456789",
			Email:        "bruno@utfpr.edu.br",
			Name:         &name,
			ClassGroupID: &classID,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.EnrollmentStatus != string(classdomain.EnrollmentActive) {
			t.Fatalf("expected ACTIVE enrollment, got %s", res.EnrollmentStatus)
		}
	})

	t.Run("duplicate email (CA-03)", func(t *testing.T) {
		_, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "9999999",
			Email:      "ana@utfpr.edu.br",
		})
		if err != domain.ErrEmailAlreadyRegistered {
			t.Fatalf("expected ErrEmailAlreadyRegistered, got %v", err)
		}
	})

	t.Run("duplicate academic id (CA-03)", func(t *testing.T) {
		_, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "a2345678",
			Email:      "outro@utfpr.edu.br",
		})
		if err != domain.ErrAcademicIDAlreadyRegistered {
			t.Fatalf("expected ErrAcademicIDAlreadyRegistered, got %v", err)
		}
	})

	t.Run("invalid academic id", func(t *testing.T) {
		_, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "123",
			Email:      "valido@utfpr.edu.br",
		})
		if err != domain.ErrInvalidAcademicID {
			t.Fatalf("expected ErrInvalidAcademicID, got %v", err)
		}
	})
}

func TestImportCSV(t *testing.T) {
	svc, studentRepo, _, _, _ := setupTestService()
	ctx := context.Background()

	classID := uuid.New()
	studentRepo.classes[classID] = classdomain.ClassGroup{
		Name:   "Turma SO",
		Status: classdomain.ClassStatusActive,
	}

	t.Run("valid CSV with comma and optional name (CA-04, CA-05, CA-06)", func(t *testing.T) {
		csvContent := `email,academic_id,name
estudante1@utfpr.edu.br,a1111111,Carlos Drummond
estudante2@utfpr.edu.br,2222222,
invalido@email,1234,Aluno Ruim
estudante1@utfpr.edu.br,a1111111,Carlos Drummond
`
		res, err := svc.ImportCSV(ctx, &classID, strings.NewReader(csvContent))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.TotalRows != 4 {
			t.Fatalf("expected 4 total rows, got %d", res.TotalRows)
		}
		if res.Created != 2 {
			t.Fatalf("expected 2 created, got %d", res.Created)
		}
		if res.Enrolled != 2 {
			t.Fatalf("expected 2 enrolled, got %d", res.Enrolled)
		}
		if res.AlreadyEnrolled != 1 {
			t.Fatalf("expected 1 already enrolled, got %d", res.AlreadyEnrolled)
		}
		if len(res.Errors) != 1 {
			t.Fatalf("expected 1 error for invalid row, got %d", len(res.Errors))
		}
		if res.Errors[0].Line != 4 {
			t.Fatalf("expected error on line 4, got %d", res.Errors[0].Line)
		}
	})

	t.Run("valid CSV with semicolon delimiter", func(t *testing.T) {
		csvContent := "email;academic_id;name\nsemicolon@utfpr.edu.br;3333333;Semicolon User\n"
		res, err := svc.ImportCSV(ctx, &classID, strings.NewReader(csvContent))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Created != 1 {
			t.Fatalf("expected 1 created, got %d", res.Created)
		}
	})

	t.Run("CSV conflict email and RA of different users", func(t *testing.T) {
		// Create user A with emailA and raA
		nameA := "User A"
		_, _ = svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "4444444",
			Email:      "usera@utfpr.edu.br",
			Name:       &nameA,
		})
		// Create user B with emailB and raB
		nameB := "User B"
		_, _ = svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "5555555",
			Email:      "userb@utfpr.edu.br",
			Name:       &nameB,
		})

		// Row pairing emailA with raB
		csvConflict := "email,academic_id\nusera@utfpr.edu.br,5555555\n"
		res, err := svc.ImportCSV(ctx, &classID, strings.NewReader(csvConflict))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(res.Errors) != 1 {
			t.Fatalf("expected 1 conflict error, got %d", len(res.Errors))
		}
		if !strings.Contains(res.Errors[0].Reason, "Conflito") {
			t.Fatalf("expected conflict message, got %s", res.Errors[0].Reason)
		}
	})

	t.Run("empty CSV returns ErrInvalidCSV", func(t *testing.T) {
		_, err := svc.ImportCSV(ctx, &classID, strings.NewReader(""))
		if err != domain.ErrInvalidCSV {
			t.Fatalf("expected ErrInvalidCSV, got %v", err)
		}
	})
}

func TestJoinByInvite(t *testing.T) {
	svc, studentRepo, _, _, _ := setupTestService()
	ctx := context.Background()

	validToken := "token-so-2026"
	classID := uuid.New()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC)

	studentRepo.classes[classID] = classdomain.ClassGroup{
		Name:             "SO Teoria e Prática",
		Status:           classdomain.ClassStatusActive,
		EnableInviteLink: true,
		InviteLinkToken:  &validToken,
		InviteLinkStart:  &start,
		InviteLinkEnd:    &end,
	}

	t.Run("successful self-registration (CA-07)", func(t *testing.T) {
		res, err := svc.JoinByInvite(ctx, validToken, service.JoinByInviteRequest{
			AcademicID: "a7777777",
			Email:      "candidato@utfpr.edu.br",
			Name:       "Candidato Aluno",
			Password:   "SenhaForte1234!",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.AccountStatus != string(userdomain.StatusActive) {
			t.Fatalf("expected ACTIVE account, got %s", res.AccountStatus)
		}
		if res.EnrollmentStatus != string(classdomain.EnrollmentPendingModeration) {
			t.Fatalf("expected PENDING_MODERATION enrollment, got %s", res.EnrollmentStatus)
		}
	})

	t.Run("invalid or expired token", func(t *testing.T) {
		_, err := svc.JoinByInvite(ctx, "token-inexistente", service.JoinByInviteRequest{
			AcademicID: "8888888",
			Email:      "outro@utfpr.edu.br",
			Name:       "Aluno",
			Password:   "SenhaForte1234!",
		})
		if err != domain.ErrInviteNotFound {
			t.Fatalf("expected ErrInviteNotFound, got %v", err)
		}
	})

	t.Run("weak password policy error", func(t *testing.T) {
		_, err := svc.JoinByInvite(ctx, validToken, service.JoinByInviteRequest{
			AcademicID: "8888888",
			Email:      "outro@utfpr.edu.br",
			Name:       "Aluno",
			Password:   "curta",
		})
		if err == nil {
			t.Fatalf("expected password error, got nil")
		}
	})
}

func TestUpdateAvatar(t *testing.T) {
	svc, _, userRepo, _, _ := setupTestService()
	ctx := context.Background()

	studentID := uuid.New()
	ra := "1234567"
	studentUser := userdomain.User{
		Email:      "estudante@utfpr.edu.br",
		AcademicID: &ra,
		Role:       userdomain.RoleStudent,
		Status:     userdomain.StatusActive,
	}
	studentUser.ID = studentID
	userRepo.users[studentID] = studentUser

	teacherID := uuid.New()
	teacherUser := userdomain.User{
		Email:  "prof@utfpr.edu.br",
		Role:   userdomain.RoleTeacher,
		Status: userdomain.StatusActive,
	}
	teacherUser.ID = teacherID
	userRepo.users[teacherID] = teacherUser

	validImg := createTestPNG(256, 256)

	t.Run("successful avatar upload (CA-10)", func(t *testing.T) {
		url, err := svc.UpdateAvatar(ctx, studentID, bytes.NewReader(validImg), int64(len(validImg)), "image/png")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.HasPrefix(url, "https://cdn.example.com/avatars/") {
			t.Fatalf("unexpected avatar URL: %s", url)
		}
	})

	t.Run("teacher cannot upload student avatar (CA-11)", func(t *testing.T) {
		_, err := svc.UpdateAvatar(ctx, teacherID, bytes.NewReader(validImg), int64(len(validImg)), "image/png")
		if err != domain.ErrNotAStudent {
			t.Fatalf("expected ErrNotAStudent, got %v", err)
		}
	})

	t.Run("invalid image format", func(t *testing.T) {
		_, err := svc.UpdateAvatar(ctx, studentID, strings.NewReader("fake-image"), 10, "application/pdf")
		if err != domain.ErrUnsupportedImageFormat {
			t.Fatalf("expected ErrUnsupportedImageFormat, got %v", err)
		}
	})

	t.Run("image dimensions too small", func(t *testing.T) {
		tinyImg := createTestPNG(64, 64)
		_, err := svc.UpdateAvatar(ctx, studentID, bytes.NewReader(tinyImg), int64(len(tinyImg)), "image/png")
		if err != domain.ErrImageDimensions {
			t.Fatalf("expected ErrImageDimensions, got %v", err)
		}
	})
}

func TestListStudentsAndGetProfile(t *testing.T) {
	svc, studentRepo, userRepo, _, _ := setupTestService()
	ctx := context.Background()

	ra1 := "1111111"
	name1 := "Alice Silva"
	avatarKey := "avatars/alice/photo.png"
	u1 := userdomain.User{
		Name:       &name1,
		Email:      "alice@utfpr.edu.br",
		AcademicID: &ra1,
		Role:       userdomain.RoleStudent,
		Status:     userdomain.StatusActive,
	}
	u1.ID = uuid.New()
	userRepo.users[u1.ID] = u1
	studentRepo.profiles[u1.ID] = domain.StudentProfile{
		UserID:          u1.ID,
		AvatarObjectKey: &avatarKey,
	}

	teacherID := uuid.New()
	userRepo.users[teacherID] = userdomain.User{
		Email:  "prof@utfpr.edu.br",
		Role:   userdomain.RoleTeacher,
		Status: userdomain.StatusActive,
	}

	t.Run("list students with search and avatar", func(t *testing.T) {
		res, err := svc.ListStudents(ctx, 1, 20, "Alice")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.TotalCount != 1 {
			t.Fatalf("expected 1 result, got %d", res.TotalCount)
		}
		if res.Items[0].Name != "Alice Silva" {
			t.Fatalf("expected Alice Silva, got %s", res.Items[0].Name)
		}
		if res.Items[0].AvatarURL == nil || !strings.Contains(*res.Items[0].AvatarURL, "https://cdn.example.com/") {
			t.Fatalf("expected enriched avatar URL, got %v", res.Items[0].AvatarURL)
		}
	})

	t.Run("get student profile", func(t *testing.T) {
		prof, err := svc.GetProfile(ctx, u1.ID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if prof.AcademicID != "1111111" {
			t.Fatalf("expected academic id 1111111, got %s", prof.AcademicID)
		}
	})

	t.Run("get profile non-existent", func(t *testing.T) {
		_, err := svc.GetProfile(ctx, uuid.New())
		if err != domain.ErrStudentNotFound {
			t.Fatalf("expected ErrStudentNotFound, got %v", err)
		}
	})

	t.Run("get profile of non-student", func(t *testing.T) {
		_, err := svc.GetProfile(ctx, teacherID)
		if err != domain.ErrNotAStudent {
			t.Fatalf("expected ErrNotAStudent, got %v", err)
		}
	})
}

func TestService_EdgeCases(t *testing.T) {
	svc, studentRepo, userRepo, _, _ := setupTestService()
	ctx := context.Background()

	t.Run("register manual with missing class", func(t *testing.T) {
		fakeClassID := uuid.New()
		_, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID:   "7771111",
			Email:        "edge1@utfpr.edu.br",
			ClassGroupID: &fakeClassID,
		})
		if err != domain.ErrClassNotFound {
			t.Fatalf("expected ErrClassNotFound, got %v", err)
		}
	})

	t.Run("register manual with whatsapp and discord", func(t *testing.T) {
		w := "+554299999999"
		d := "user#1234"
		res, err := svc.RegisterManual(ctx, service.RegisterManualRequest{
			AcademicID: "7772222",
			Email:      "edge2@utfpr.edu.br",
			Whatsapp:   &w,
			Discord:    &d,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		p, _ := studentRepo.GetProfileByUserID(ctx, res.ID)
		if p == nil || p.Whatsapp == nil || *p.Whatsapp != w {
			t.Fatalf("expected whatsapp profile to be saved")
		}
	})

	t.Run("import csv with missing class", func(t *testing.T) {
		fakeClassID := uuid.New()
		_, err := svc.ImportCSV(ctx, &fakeClassID, strings.NewReader("email,academic_id\na@b.com,1112223"))
		if err != domain.ErrClassNotFound {
			t.Fatalf("expected ErrClassNotFound, got %v", err)
		}
	})

	t.Run("import csv missing required headers", func(t *testing.T) {
		_, err := svc.ImportCSV(ctx, nil, strings.NewReader("nome,telefone\njoao,12345"))
		if err != domain.ErrInvalidCSV {
			t.Fatalf("expected ErrInvalidCSV, got %v", err)
		}
	})

	t.Run("join by invite expired", func(t *testing.T) {
		token := "token-expirado"
		classID := uuid.New()
		past := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		studentRepo.classes[classID] = classdomain.ClassGroup{
			Name:             "Turma Expirada",
			EnableInviteLink: true,
			InviteLinkToken:  &token,
			InviteLinkStart:  &past,
			InviteLinkEnd:    &past,
		}
		_, err := svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "7773333",
			Email:      "exp@utfpr.edu.br",
			Name:       "Aluno Expirado",
			Password:   "SenhaValida123!",
		})
		if err != domain.ErrInviteExpired {
			t.Fatalf("expected ErrInviteExpired, got %v", err)
		}
	})

	t.Run("join by invite empty name", func(t *testing.T) {
		token := "token-valido"
		classID := uuid.New()
		start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		end := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
		studentRepo.classes[classID] = classdomain.ClassGroup{
			Name:             "Turma Valida",
			Status:           classdomain.ClassStatusActive,
			EnableInviteLink: true,
			InviteLinkToken:  &token,
			InviteLinkStart:  &start,
			InviteLinkEnd:    &end,
		}
		_, err := svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "7774444",
			Email:      "noname@utfpr.edu.br",
			Name:       "   ",
			Password:   "SenhaValida123!",
		})
		if err == nil {
			t.Fatalf("expected error for empty name, got nil")
		}
	})

	t.Run("join by invite duplicate email or RA", func(t *testing.T) {
		token := "token-dup"
		classID := uuid.New()
		start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		end := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
		studentRepo.classes[classID] = classdomain.ClassGroup{
			Name:             "Turma Dup",
			Status:           classdomain.ClassStatusActive,
			EnableInviteLink: true,
			InviteLinkToken:  &token,
			InviteLinkStart:  &start,
			InviteLinkEnd:    &end,
		}

		raExisting := "7775555"
		existingU := userdomain.User{
			Email:      "dup@utfpr.edu.br",
			AcademicID: &raExisting,
			Role:       userdomain.RoleStudent,
		}
		existingU.ID = uuid.New()
		userRepo.users[existingU.ID] = existingU

		// Duplicate email
		_, err := svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "7776666",
			Email:      "dup@utfpr.edu.br",
			Name:       "Outro",
			Password:   "SenhaValida123!",
		})
		if err != domain.ErrEmailAlreadyRegistered {
			t.Fatalf("expected ErrEmailAlreadyRegistered, got %v", err)
		}

		// Duplicate academic ID
		_, err = svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "7775555",
			Email:      "outroemail@utfpr.edu.br",
			Name:       "Outro",
			Password:   "SenhaValida123!",
		})
		if err != domain.ErrAcademicIDAlreadyRegistered {
			t.Fatalf("expected ErrAcademicIDAlreadyRegistered, got %v", err)
		}
	})

	t.Run("avatar with valid JPEG format", func(t *testing.T) {
		studentID := uuid.New()
		ra := "8881234"
		studentUser := userdomain.User{
			Email:      "jpeg_student@utfpr.edu.br",
			AcademicID: &ra,
			Role:       userdomain.RoleStudent,
			Status:     userdomain.StatusActive,
		}
		studentUser.ID = studentID
		userRepo.users[studentID] = studentUser

		jpegImg := createTestJPEG(200, 200)
		url, err := svc.UpdateAvatar(ctx, studentID, bytes.NewReader(jpegImg), int64(len(jpegImg)), "image/jpeg")
		if err != nil {
			t.Fatalf("unexpected error for jpeg upload: %v", err)
		}
		if !strings.HasPrefix(url, "https://cdn.example.com/avatars/") {
			t.Fatalf("unexpected avatar url: %s", url)
		}

		// Also verify GetProfile returns the avatar URL
		prof, err := svc.GetProfile(ctx, studentID)
		if err != nil {
			t.Fatalf("unexpected error get profile: %v", err)
		}
		if prof.AvatarURL == nil || *prof.AvatarURL != url {
			t.Fatalf("expected profile avatar to be set to %s", url)
		}
	})

	t.Run("avatar with oversized buffer", func(t *testing.T) {
		studentID := uuid.New()
		ra := "8885678"
		studentUser := userdomain.User{
			Email:      "large_student@utfpr.edu.br",
			AcademicID: &ra,
			Role:       userdomain.RoleStudent,
			Status:     userdomain.StatusActive,
		}
		studentUser.ID = studentID
		userRepo.users[studentID] = studentUser

		_, err := svc.UpdateAvatar(ctx, studentID, strings.NewReader(""), domain.MaxAvatarFileSize+10, "image/jpeg")
		if err != domain.ErrImageTooLarge {
			t.Fatalf("expected ErrImageTooLarge, got %v", err)
		}
	})

	t.Run("join by invite with invalid RA or invalid email", func(t *testing.T) {
		token := "token-valido"
		_, err := svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "123",
			Email:      "valido@utfpr.edu.br",
			Name:       "Aluno",
			Password:   "SenhaValida123!",
		})
		if err != domain.ErrInvalidAcademicID {
			t.Fatalf("expected ErrInvalidAcademicID, got %v", err)
		}

		_, err = svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "1234567",
			Email:      "invalido",
			Name:       "Aluno",
			Password:   "SenhaValida123!",
		})
		if err != domain.ErrInvalidEmail {
			t.Fatalf("expected ErrInvalidEmail, got %v", err)
		}
	})

	t.Run("join by invite with whatsapp and discord", func(t *testing.T) {
		token := "token-valido"
		w := "+554298888888"
		d := "disc#4321"
		res, err := svc.JoinByInvite(ctx, token, service.JoinByInviteRequest{
			AcademicID: "9991234",
			Email:      "wpp@utfpr.edu.br",
			Name:       "Aluno Completo",
			Password:   "SenhaValida123!",
			Whatsapp:   &w,
			Discord:    &d,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		p, _ := studentRepo.GetProfileByUserID(ctx, res.UserID)
		if p == nil || p.Whatsapp == nil || *p.Whatsapp != w {
			t.Fatalf("expected profile with whatsapp")
		}
	})

	t.Run("import csv with existing user enrolled into new class", func(t *testing.T) {
		newClassID := uuid.New()
		studentRepo.classes[newClassID] = classdomain.ClassGroup{
			Name:   "Segunda Turma",
			Status: classdomain.ClassStatusActive,
		}

		csvContent := "email,academic_id\nwpp@utfpr.edu.br,9991234\n"
		res, err := svc.ImportCSV(ctx, &newClassID, strings.NewReader(csvContent))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Enrolled != 1 {
			t.Fatalf("expected 1 enrolled, got %d", res.Enrolled)
		}
		if res.Created != 0 {
			t.Fatalf("expected 0 created, got %d", res.Created)
		}
	})
}

