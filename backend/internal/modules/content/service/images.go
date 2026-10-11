package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"

	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// ErrImageStorage means the bucket could not be reached; the teacher may try again.
var ErrImageStorage = errors.New("image storage unavailable")

// ImageStore is the bucket the images live in.
type ImageStore interface {
	// Exists tells whether an object with this name is already in the bucket.
	Exists(ctx context.Context, key string) (bool, error)
	// PutImmutable stores an object whose name comes from its content, so it can be cached for good.
	PutImmutable(ctx context.Context, key string, data []byte, contentType string) error
	// URL is the public address of an object.
	URL(key string) string
}

// UploadedImage is what the teacher gets back after sending an image.
type UploadedImage struct {
	URL    string
	Width  int
	Height int
	Bytes  int
}

// Images is the use case of the images of the content (SPEC-025).
type Images struct {
	store ImageStore
	log   *zap.Logger
	// slots bounds how many conversions run at once: encoding is heavy on the CPU.
	slots chan struct{}
}

// NewImages creates the use case; `concurrent` is how many images are converted at the same time.
func NewImages(store ImageStore, log *zap.Logger, concurrent int) *Images {
	if concurrent < 1 {
		concurrent = 1
	}
	return &Images{store: store, log: log.Named("images"), slots: make(chan struct{}, concurrent)}
}

// Upload converts the image and keeps it in the bucket under the name of its content. An image that is already there is not sent again
// (RN-06), and nothing is ever removed from the bucket (RN-08).
func (s *Images) Upload(ctx context.Context, raw []byte) (UploadedImage, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return UploadedImage{}, ctx.Err()
	}
	img, err := domain.ProcessImage(raw)
	if err != nil {
		return UploadedImage{}, err
	}
	exists, err := s.store.Exists(ctx, img.Key)
	if err != nil {
		s.log.Warn("image storage check failed", zap.Error(err))
		return UploadedImage{}, fmt.Errorf("%w: %v", ErrImageStorage, err)
	}
	if !exists {
		if err := s.store.PutImmutable(ctx, img.Key, bytes.Clone(img.Data), img.ContentType); err != nil {
			s.log.Warn("image storage put failed", zap.Error(err))
			return UploadedImage{}, fmt.Errorf("%w: %v", ErrImageStorage, err)
		}
	}
	return UploadedImage{URL: s.store.URL(img.Key), Width: img.Width, Height: img.Height, Bytes: len(img.Data)}, nil
}
