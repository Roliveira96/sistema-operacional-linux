// Package storage wraps the MinIO object storage client.
package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/config"
)

// Storage gives access to the configured bucket.
type Storage struct {
	client   *minio.Client
	bucket   string
	endpoint string
	useSSL   bool
}

// New creates the MinIO client. It does not contact the server.
func New(cfg config.StorageConfig) (*Storage, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}
	return &Storage{
		client:   client,
		bucket:   cfg.Bucket,
		endpoint: cfg.Endpoint,
		useSSL:   cfg.UseSSL,
	}, nil
}

// EnsureBucket creates the configured bucket when it does not exist yet.
func (s *Storage) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check bucket %s: %w", s.bucket, err)
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
		return fmt.Errorf("create bucket %s: %w", s.bucket, err)
	}
	return nil
}

// Ping checks that the server answers and the bucket is reachable.
func (s *Storage) Ping(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("bucket %s does not exist", s.bucket)
	}
	return nil
}

// PutObject uploads an object to the configured storage bucket.
func (s *Storage) PutObject(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("put object %s: %w", objectKey, err)
	}
	return nil
}

// PresignedGetURL returns a temporary address that lets whoever has it read the object, valid for ttl (SPEC-051: the decks of the live
// classroom are not public; each student asks for a fresh address).
func (s *Storage) PresignedGetURL(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	u, err := s.client.PresignedGetObject(ctx, s.bucket, objectKey, ttl, nil)
	if err != nil {
		return "", fmt.Errorf("sign object %s: %w", objectKey, err)
	}
	return u.String(), nil
}

// GetObjectURL returns a URL to access the object key.
func (s *Storage) GetObjectURL(objectKey string) string {
	if objectKey == "" {
		return ""
	}
	scheme := "http"
	if s.useSSL {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, s.endpoint, s.bucket, objectKey)
}


// Exists tells whether an object is in the bucket.
func (s *Storage) Exists(ctx context.Context, objectKey string) (bool, error) {
	_, err := s.client.StatObject(ctx, s.bucket, objectKey, minio.StatObjectOptions{})
	if err == nil {
		return true, nil
	}
	if minio.ToErrorResponse(err).Code == "NoSuchKey" {
		return false, nil
	}
	return false, fmt.Errorf("stat object %s: %w", objectKey, err)
}

// PutImmutable uploads an object whose name comes from its content, so browsers and proxies can keep it for good.
func (s *Storage) PutImmutable(ctx context.Context, objectKey string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType:  contentType,
		CacheControl: "public, max-age=31536000, immutable",
	})
	if err != nil {
		return fmt.Errorf("put object %s: %w", objectKey, err)
	}
	return nil
}

// URL is the public address of an object.
func (s *Storage) URL(objectKey string) string { return s.GetObjectURL(objectKey) }

// AllowPublicRead lets anyone read the objects under a prefix, and only them; the rest of the bucket stays private. It adds one statement
// to the policy the bucket already has, so what was granted before (the avatars, for one) is kept, and it can run at every start.
func (s *Storage) AllowPublicRead(ctx context.Context, prefix string) error {
	if prefix == "" {
		return errors.New("prefix is required")
	}
	current, err := s.client.GetBucketPolicy(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("get the policy of %s: %w", s.bucket, err)
	}
	merged, err := withPublicRead(current, s.bucket, prefix)
	if err != nil {
		return err
	}
	if err := s.client.SetBucketPolicy(ctx, s.bucket, merged); err != nil {
		return fmt.Errorf("set public read of %s: %w", prefix, err)
	}
	return nil
}

// withPublicRead returns `current` (a bucket policy, possibly empty) with a statement that lets anyone read what is under `prefix`.
func withPublicRead(current, bucket, prefix string) (string, error) {
	policy := map[string]any{"Version": "2012-10-17"}
	if strings.TrimSpace(current) != "" {
		if err := json.Unmarshal([]byte(current), &policy); err != nil {
			return "", fmt.Errorf("read the policy of %s: %w", bucket, err)
		}
	}
	sid := "PublicRead" + strings.NewReplacer("/", "", "-", "", "_", "").Replace(prefix)
	statements, _ := policy["Statement"].([]any)
	kept := make([]any, 0, len(statements)+1)
	for _, st := range statements {
		if m, ok := st.(map[string]any); ok && m["Sid"] == sid {
			continue
		}
		kept = append(kept, st)
	}
	kept = append(kept, map[string]any{
		"Sid":       sid,
		"Effect":    "Allow",
		"Principal": map[string]any{"AWS": []string{"*"}},
		"Action":    []string{"s3:GetObject"},
		"Resource":  []string{fmt.Sprintf("arn:aws:s3:::%s/%s*", bucket, prefix)},
	})
	policy["Statement"] = kept
	out, err := json.Marshal(policy)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
