// Package service is the public interface of the user module. Other modules
// use it instead of the repository.
package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
)

// Repository is the persistence port of the service.
type Repository interface {
	FindByID(ctx context.Context, id uuid.UUID) (domain.User, error)
	FindByEmail(ctx context.Context, email string) (domain.User, error)
	FindByAcademicID(ctx context.Context, academicID string) (domain.User, error)
	Create(ctx context.Context, u *domain.User) error
	UpdatePassword(ctx context.Context, id uuid.UUID, hash string, mustChange bool) error
}

// Service manages user accounts.
type Service struct {
	repo Repository
}

// New creates the service.
func New(repo Repository) *Service {
	return &Service{repo: repo}
}

// FindByID returns the user or domain.ErrNotFound.
func (s *Service) FindByID(ctx context.Context, id uuid.UUID) (domain.User, error) {
	return s.repo.FindByID(ctx, id)
}

// FindByIdentifier resolves an e-mail or academic id.
func (s *Service) FindByIdentifier(ctx context.Context, id domain.Identifier) (domain.User, error) {
	if id.IsEmail() {
		return s.repo.FindByEmail(ctx, id.Email)
	}
	return s.repo.FindByAcademicID(ctx, id.AcademicID)
}

// FindByEmail returns the user with the normalized e-mail.
func (s *Service) FindByEmail(ctx context.Context, email string) (domain.User, error) {
	normalized, err := domain.NormalizeEmail(email)
	if err != nil {
		return domain.User{}, err
	}
	return s.repo.FindByEmail(ctx, normalized)
}

// Create normalizes and inserts a new user.
func (s *Service) Create(ctx context.Context, u *domain.User) error {
	email, err := domain.NormalizeEmail(u.Email)
	if err != nil {
		return err
	}
	u.Email = email
	if u.AcademicID != nil {
		ra, err := domain.NormalizeAcademicID(*u.AcademicID)
		if err != nil {
			return err
		}
		u.AcademicID = &ra
	}
	if u.Status == "" {
		u.Status = domain.StatusActive
	}
	return s.repo.Create(ctx, u)
}

// SetPassword stores a new password hash and the must-change flag.
func (s *Service) SetPassword(ctx context.Context, id uuid.UUID, hash string, mustChange bool) error {
	return s.repo.UpdatePassword(ctx, id, hash, mustChange)
}
