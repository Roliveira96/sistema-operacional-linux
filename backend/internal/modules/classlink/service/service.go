// Package service has the rules of the links of a class (SPEC-048).
package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
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
	List(ctx context.Context, classID uuid.UUID) ([]domain.ClassLink, error)
	// Replace saves the list as a whole, in one transaction (SPEC-048 RN-03).
	Replace(ctx context.Context, classID uuid.UUID, links []domain.ClassLink) error
}

// Actor is who is calling.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// Service runs the use cases.
type Service struct {
	repo Repository
}

// New creates the service.
func New(repo Repository) *Service { return &Service{repo: repo} }

// writable returns the class when the actor may change its links: the owner teacher or an administrator (RN-04).
func (s *Service) writable(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if actor.Role != authn.RoleTeacher && actor.Role != authn.RoleAdmin {
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

// List returns the links of the class in order. A student without an active enrollment gets ErrClassNotFound, so the class is not
// revealed (RN-04).
func (s *Service) List(ctx context.Context, actor Actor, classID uuid.UUID) ([]domain.ClassLink, error) {
	if actor.Role == authn.RoleStudent {
		if _, err := s.repo.FindClass(ctx, classID); err != nil {
			return nil, err
		}
		active, err := s.repo.IsActiveStudent(ctx, classID, actor.UserID)
		if err != nil {
			return nil, err
		}
		if !active {
			return nil, domain.ErrClassNotFound
		}
	} else if _, err := s.writable(ctx, actor, classID); err != nil {
		return nil, err
	}
	return s.repo.List(ctx, classID)
}

// Replace saves the whole list of the class (RN-01 to RN-05).
func (s *Service) Replace(ctx context.Context, actor Actor, classID uuid.UUID, in []domain.Input) ([]domain.ClassLink, error) {
	class, err := s.writable(ctx, actor, classID)
	if err != nil {
		return nil, err
	}
	if class.Archived {
		return nil, domain.ErrClassArchived
	}
	links, err := domain.BuildLinks(classID, in)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Replace(ctx, classID, links); err != nil {
		return nil, err
	}
	return links, nil
}
